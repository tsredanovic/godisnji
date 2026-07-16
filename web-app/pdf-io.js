'use strict';

// ── PDF export / import ─────────────────────────────────────────────────────
//
// Export renders a printable report of the Results view (per-year progress
// and vacation log, mirroring the web UI) using pdf-lib, then embeds the
// full state as a hidden JSON attachment inside the PDF. Import reads that
// attachment back out of a chosen PDF and restores it as app state.

const PDF_ATTACHMENT_NAME = 'godisnji-data.json';

// Reads the app's actual theme colors (style.css `:root` custom properties)
// instead of hardcoding a second copy of them here.
function readThemeColors() {
  const css = getComputedStyle(document.documentElement);
  const v = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
  return {
    text:  v('--text', '#1a1d23'),
    muted: v('--text-muted', '#6b7280'),
    barBg: v('--bar-bg', '#e5e7eb'),
    pLow:  v('--p-low', '#38bdf8'),
    pMid:  v('--p-mid', '#3b82f6'),
    pHigh: v('--p-high', '#6366f1'),
    pFull: v('--p-full', '#7c3aed'),
    pOver: v('--red', '#ef4444'),
  };
}

function hexColor(hex) {
  const n = parseInt(hex.slice(1), 16);
  return PDFLib.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function barColorFor(colors, barClass) {
  const hex = {
    'p-low': colors.pLow, 'p-mid': colors.pMid,
    'p-high': colors.pHigh, 'p-full': colors.pFull, 'p-over': colors.pOver,
  }[barClass] || colors.pLow;
  return hexColor(hex);
}

// ── Page/layout helper ───────────────────────────────────────────────────────

class PdfReport {
  constructor(pdfDoc, font, bold, textColor) {
    this.pdfDoc     = pdfDoc;
    this.font        = font;
    this.bold        = bold;
    this.textColor   = textColor;
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

  get maxBlockHeight() {
    return this.pageH - this.marginTop - this.marginBottom;
  }

  addPage() {
    this.page = this.pdfDoc.addPage([this.pageW, this.pageH]);
    this.y = this.pageH - this.marginTop;
  }

  // Starts a new page if `height` doesn't fit in the remaining space on the
  // current one. Returns true when a new page was started, so callers can
  // redraw context (e.g. a "continued" header) that doesn't otherwise repeat.
  ensureSpace(height) {
    if (this.y - height < this.marginBottom) {
      this.addPage();
      return true;
    }
    return false;
  }

  text(str, { x, y, size = 9.5, font, color } = {}) {
    this.page.drawText(str, {
      x: x ?? this.marginX,
      y: y ?? this.y,
      size,
      font: font || this.font,
      color: color || this.textColor,
    });
  }

  rect({ x, y, width, height, color }) {
    this.page.drawRectangle({ x, y, width, height, color });
  }
}

// ── Results section (mirrors buildYearCard) ─────────────────────────────────

function drawResults(r, yearsMap, vacView, colors) {
  const yearNums = Object.keys(yearsMap).map(Number).sort((a, b) => b - a);
  if (!yearNums.length) return;

  const mutedColor = hexColor(colors.muted);
  const overColor = hexColor(colors.pOver);

  for (const yearNum of yearNums) {
    const yr = yearsMap[yearNum];
    const { entries, actualDays, remaining, pct, barClass } =
      computeYearStats(yr, yearNum, vacView[yearNum] || new Map());

    // Reserve space for the whole year block (heading + bar + its log lines)
    // up front, so a year with more than a couple of entries doesn't get its
    // heading stranded on one page while all its entries land on the next.
    // Capped at a full page's height for years with too many entries to fit
    // on any single page — those still need the per-entry fallback below.
    const entryLinesHeight = entries.length ? entries.length * 15 : 20;
    const blockHeight = Math.min(16 + 22 + entryLinesHeight + 12, r.maxBlockHeight);
    r.ensureSpace(blockHeight);

    r.text(String(yearNum), { size: 15, font: r.bold });
    const statsStr = `${yr.allowedDays} allowed   ${actualDays} used   ${remaining < 0 ? `${Math.abs(remaining)} over` : `${remaining} left`}`;
    const statsW = r.font.widthOfTextAtSize(statsStr, 9.5);
    r.text(statsStr, {
      x: r.marginX + r.contentW - statsW, size: 9.5,
      color: remaining < 0 ? overColor : mutedColor,
    });
    r.y -= 16;

    // Progress bar
    const barH = 6;
    r.rect({ x: r.marginX, y: r.y - barH + 2, width: r.contentW, height: barH, color: hexColor(colors.barBg) });
    const fillW = Math.max(0, Math.min(1, pct / 100)) * r.contentW;
    if (fillW > 0) {
      r.rect({ x: r.marginX, y: r.y - barH + 2, width: fillW, height: barH, color: barColorFor(colors, barClass) });
    }
    r.y -= 22;

    if (!entries.length) {
      r.text('No vacations recorded.', { size: 9, color: mutedColor });
      r.y -= 20;
      continue;
    }

    for (const entry of entries) {
      const newPage = r.ensureSpace(16);
      if (newPage) {
        r.text(`${yearNum} (continued)`, { size: 9.5, font: r.bold, color: mutedColor });
        r.y -= 16;
      }

      const daysLabel = formatDaysLabel(entry.vac.days);
      const cross = crossBudgetSummary(entry, yearNum);
      const crossStr = cross ? `  (${cross.days} from ${cross.year})` : '';
      const dateStr = `${fmtDate(entry.vac.start)} – ${fmtDate(entry.vac.end)}`;
      r.text(dateStr, { x: r.marginX + 12, size: 9 });
      const rightStr = `${crossStr}   ${daysLabel}`.trim();
      const rightW = r.font.widthOfTextAtSize(rightStr, 9);
      r.text(rightStr, { x: r.marginX + r.contentW - rightW, size: 9, color: mutedColor });
      r.y -= 15;
    }
    r.y -= 12;
  }
}

// ── Export ───────────────────────────────────────────────────────────────────

async function exportPdf() {
  const { PDFDocument, StandardFonts } = PDFLib;
  const colors = readThemeColors();

  const pdfDoc = await PDFDocument.create();
  const [font, bold] = await Promise.all([
    pdfDoc.embedFont(StandardFonts.Helvetica),
    pdfDoc.embedFont(StandardFonts.HelveticaBold),
  ]);

  const r = new PdfReport(pdfDoc, font, bold, hexColor(colors.text));

  r.text('Godisnji', { size: 20, font: bold });
  r.y -= 18;
  const today = new Date();
  const pad = n => String(n).padStart(2, '0');
  const dateStr = `${pad(today.getDate())}.${pad(today.getMonth() + 1)}.${today.getFullYear()}`;
  const { name, employer } = state.profile || {};
  const whoStr = name ? ` - ${name}${employer ? ` at ${employer}` : ''}` : '';
  r.text(`Vacation Days${whoStr} - exported ${dateStr}`,
    { size: 9.5, color: hexColor(colors.muted) });
  r.y -= 24;

  const yearsMap = calculate();
  const vacView = buildVacView(yearsMap);
  drawResults(r, yearsMap, vacView, colors);

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

// Recursively collects every leaf `/Names` array out of a PDF name tree node,
// which is either a leaf (`/Names`) or an intermediate node (`/Kids`, each
// itself a name tree node) per the PDF spec's name tree structure.
function collectNameTreeLeaves(namesTreeDict, out) {
  const { PDFName, PDFDict, PDFArray } = PDFLib;
  const kids = namesTreeDict.lookupMaybe(PDFName.of('Kids'), PDFArray);
  if (kids) {
    for (let i = 0; i < kids.size(); i++) {
      collectNameTreeLeaves(kids.lookup(i, PDFDict), out);
    }
    return;
  }
  const namesArr = namesTreeDict.lookupMaybe(PDFName.of('Names'), PDFArray);
  if (namesArr) out.push(namesArr);
}

// Walks the PDF's Names/EmbeddedFiles tree to pull out the raw bytes of the
// attachment we embedded on export. pdf-lib (1.17.x) can only *write*
// attachments via the high-level API, not read them back, so this reads the
// low-level object graph directly.
async function extractEmbeddedJson(pdfDoc) {
  const { PDFName, PDFDict, decodePDFRawStream } = PDFLib;

  const namesDict = pdfDoc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
  const embeddedFilesDict = namesDict && namesDict.lookupMaybe(PDFName.of('EmbeddedFiles'), PDFDict);
  if (!embeddedFilesDict) return null;

  const nameArrays = [];
  collectNameTreeLeaves(embeddedFilesDict, nameArrays);

  for (const efNames of nameArrays) {
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
