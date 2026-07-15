'use strict';

// ── PDF export / import ─────────────────────────────────────────────────────
//
// Export renders a printable report of the Results view (per-year progress
// and vacation log, mirroring the web UI) using pdf-lib, then embeds the
// full state as a hidden JSON attachment inside the PDF. Import reads that
// attachment back out of a chosen PDF and restores it as app state.

const PDF_ATTACHMENT_NAME = 'godisnji-data.json';

const PDF_COLORS = {
  text:  '#1a1d23',
  muted: '#6b7280',
  barBg: '#e5e7eb',
  pLow:  '#38bdf8',
  pMid:  '#3b82f6',
  pHigh: '#6366f1',
  pFull: '#7c3aed',
  pOver: '#ef4444',
};

function hexColor(hex) {
  const n = parseInt(hex.slice(1), 16);
  return PDFLib.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function barColorFor(barClass) {
  return hexColor({
    'p-low': PDF_COLORS.pLow, 'p-mid': PDF_COLORS.pMid,
    'p-high': PDF_COLORS.pHigh, 'p-full': PDF_COLORS.pFull, 'p-over': PDF_COLORS.pOver,
  }[barClass] || PDF_COLORS.pLow);
}

// ── Page/layout helper ───────────────────────────────────────────────────────

class PdfReport {
  constructor(pdfDoc, font, bold) {
    this.pdfDoc     = pdfDoc;
    this.font        = font;
    this.bold        = bold;
    this.pageW       = 595.28; // A4 portrait, points
    this.pageH       = 841.89;
    this.marginX     = 48;
    this.marginTop   = 48;
    this.marginBottom = 44;
    this.contentW    = this.pageW - this.marginX * 2;
    this.page = null;
    this.y = 0;
    this.addPage();
  }

  addPage() {
    this.page = this.pdfDoc.addPage([this.pageW, this.pageH]);
    this.y = this.pageH - this.marginTop;
  }

  ensureSpace(height) {
    if (this.y - height < this.marginBottom) this.addPage();
  }

  text(str, { x, y, size = 9.5, font, color, maxWidth } = {}) {
    let s = str;
    const f = font || this.font;
    if (maxWidth) {
      while (s.length > 1 && f.widthOfTextAtSize(s, size) > maxWidth) s = s.slice(0, -1);
      if (s !== str) s = s.slice(0, -1) + '…';
    }
    this.page.drawText(s, {
      x: x ?? this.marginX,
      y: y ?? this.y,
      size,
      font: f,
      color: color || hexColor(PDF_COLORS.text),
    });
  }

  rect({ x, y, width, height, color, borderColor, borderWidth }) {
    this.page.drawRectangle({ x, y, width, height, color, borderColor, borderWidth });
  }

}

// ── Results section (mirrors buildYearCard) ─────────────────────────────────

function drawResults(r, yearsMap, vacView) {
  const yearNums = Object.keys(yearsMap).map(Number).sort((a, b) => b - a);
  if (!yearNums.length) return;

  for (const yearNum of yearNums) {
    const yr = yearsMap[yearNum];
    const { entries, actualDays, remaining, isOver, pct, barClass } =
      computeYearStats(yr, yearNum, vacView[yearNum] || new Map());

    r.ensureSpace(58);

    r.text(String(yearNum), { size: 15, font: r.bold });
    const statsStr = `${yr.allowedDays} allowed   ${actualDays} used   ${remaining < 0 ? `${Math.abs(remaining)} over` : `${remaining} left`}`;
    const statsW = r.font.widthOfTextAtSize(statsStr, 9.5);
    r.text(statsStr, {
      x: r.marginX + r.contentW - statsW, size: 9.5,
      color: remaining < 0 ? hexColor(PDF_COLORS.pOver) : hexColor(PDF_COLORS.muted),
    });
    r.y -= 16;

    // Progress bar
    const barH = 6;
    r.rect({ x: r.marginX, y: r.y - barH + 2, width: r.contentW, height: barH, color: hexColor(PDF_COLORS.barBg) });
    const fillW = Math.max(0, Math.min(1, pct / 100)) * r.contentW;
    if (fillW > 0) {
      r.rect({ x: r.marginX, y: r.y - barH + 2, width: fillW, height: barH, color: barColorFor(barClass) });
    }
    r.y -= 22;

    if (!entries.length) {
      r.text('No vacations recorded.', { size: 9, color: hexColor(PDF_COLORS.muted) });
      r.y -= 20;
      continue;
    }

    for (const entry of entries) {
      r.ensureSpace(16);
      const inputDays = Number(entry.vac.days) || 0;
      const daysLabel = inputDays === 1 ? '1 day' : `${inputDays} days`;
      const crossBudgets = entry.fromBudgets.filter(b => b.budgetYear !== yearNum);
      const crossStr = crossBudgets.length
        ? `  (${crossBudgets.reduce((s, b) => s + b.days, 0)} from ${crossBudgets[0].budgetYear})`
        : '';
      const dateStr = `${fmtDate(entry.vac.start)} – ${fmtDate(entry.vac.end)}`;
      r.text(dateStr, { x: r.marginX + 12, size: 9 });
      const rightStr = `${crossStr}   ${daysLabel}`.trim();
      const rightW = r.font.widthOfTextAtSize(rightStr, 9);
      r.text(rightStr, { x: r.marginX + r.contentW - rightW, size: 9, color: hexColor(PDF_COLORS.muted) });
      r.y -= 15;
    }
    r.y -= 12;
  }
}

// ── Export ───────────────────────────────────────────────────────────────────

async function exportPdf() {
  const { PDFDocument, StandardFonts } = PDFLib;

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const r = new PdfReport(pdfDoc, font, bold);

  r.text('Godisnji', { size: 20, font: bold });
  r.y -= 18;
  const today = new Date();
  const pad = n => String(n).padStart(2, '0');
  r.text(`Vacation Days Tracker — exported ${pad(today.getDate())}.${pad(today.getMonth() + 1)}.${today.getFullYear()}`,
    { size: 9.5, color: hexColor(PDF_COLORS.muted) });
  r.y -= 24;

  const yearsMap = calculate();
  const vacView = buildVacView(yearsMap);
  drawResults(r, yearsMap, vacView);

  const jsonBytes = new TextEncoder().encode(JSON.stringify(state));
  await pdfDoc.attach(jsonBytes, PDF_ATTACHMENT_NAME, {
    mimeType: 'application/json',
    description: 'Godisnji vacation data (years + vacations) — import this file back into the app.',
  });

  const pdfBytes = await pdfDoc.save();
  const filename = `godisnji-${today.getFullYear()}${pad(today.getMonth() + 1)}${pad(today.getDate())}.pdf`;
  downloadBytes(pdfBytes, filename, 'application/pdf');
}

function downloadBytes(bytes, filename, mime) {
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ── Import ───────────────────────────────────────────────────────────────────

// Walks the PDF's Names/EmbeddedFiles tree to pull out the raw bytes of the
// attachment we embedded on export. pdf-lib (1.17.x) can only *write*
// attachments via the high-level API, not read them back, so this reads the
// low-level object graph directly.
async function extractEmbeddedJson(pdfDoc) {
  const { PDFName, PDFDict, PDFArray, decodePDFRawStream } = PDFLib;

  const namesDict = pdfDoc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
  const embeddedFilesDict = namesDict && namesDict.lookupMaybe(PDFName.of('EmbeddedFiles'), PDFDict);
  const efNames = embeddedFilesDict && embeddedFilesDict.lookupMaybe(PDFName.of('Names'), PDFArray);
  if (!efNames) return null;

  for (let i = 0; i < efNames.size(); i += 2) {
    const nameObj = efNames.lookup(i);
    const name = typeof nameObj.decodeText === 'function' ? nameObj.decodeText() : String(nameObj);
    if (name !== PDF_ATTACHMENT_NAME) continue;

    const fileSpec = efNames.lookup(i + 1, PDFDict);
    const efDict = fileSpec.lookup(PDFName.of('EF'), PDFDict);
    const fileRef = efDict.get(PDFName.of('F'));
    const stream = pdfDoc.context.lookup(fileRef);
    const bytes = decodePDFRawStream(stream).decode();
    return new TextDecoder('utf-8').decode(bytes);
  }
  return null;
}

async function importPdfFile(file) {
  const { PDFDocument } = PDFLib;

  let pdfDoc;
  try {
    const bytes = await file.arrayBuffer();
    pdfDoc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (e) {
    alert('Could not read that file as a PDF.');
    return;
  }

  let json;
  try {
    json = await extractEmbeddedJson(pdfDoc);
  } catch (e) {
    json = null;
  }
  if (!json) {
    alert('This PDF does not contain Godisnji vacation data (no embedded data file found). Only PDFs exported from Godisnji can be imported.');
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    alert('The data embedded in this PDF is corrupted and could not be read.');
    return;
  }
  if (!Array.isArray(parsed?.years) || !Array.isArray(parsed?.vacations)) {
    alert('The data embedded in this PDF is not in the expected format.');
    return;
  }

  const msg = `Import ${parsed.years.length} year(s) and ${parsed.vacations.length} vacation(s) from this PDF? This will replace all current data.`;
  if (!confirm(msg)) return;

  state = parsed;
  saveState();
  render();
}
