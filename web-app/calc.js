'use strict';

// Pure date/carryover-calculation logic, kept dependency-free from the DOM so
// it can be loaded both as a plain global script (browser) and as a CommonJS
// module (Node's built-in test runner — see test/app.test.js).

// ── Date utilities ───────────────────────────────────────────────────────────

// Parse "YYYY-MM-DD" as a local-time date (avoids UTC offset issues).
function parseLocalDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

// Count weekdays (Mon–Fri) inclusive between two "YYYY-MM-DD" strings.
function countWeekdays(startStr, endStr) {
  if (!startStr || !endStr) return 0;
  const start = parseLocalDate(startStr);
  const end   = parseLocalDate(endStr);
  if (isNaN(start) || isNaN(end) || end < start) return 0;
  let count = 0;
  const cur = new Date(start);
  while (cur <= end) {
    const d = cur.getDay();
    if (d !== 0 && d !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

// "YYYY-MM-DD" → "DD.MM.YYYY"
function fmtDate(str) {
  if (!str) return '';
  const [y, m, d] = str.split('-');
  return `${d}.${m}.${y}`;
}

// Parse "DD.MM" cutoff string → { day, month } or { day: null, month: null }
function parseCutoff(str) {
  const s = (str || '').trim();
  if (!s) return { day: null, month: null };
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.?$/);
  if (!m) return { day: null, month: null };
  const day = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  if (day < 1 || day > 31 || month < 1 || month > 12) return { day: null, month: null };
  return { day, month };
}

function fmtCutoff(day, month) {
  if (!day || !month) return '';
  return `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}`;
}

function sameYear(a, b) {
  if (!a || !b) return true;
  return a.slice(0, 4) === b.slice(0, 4);
}

// ── Calculation (port of tools.py) ──────────────────────────────────────────
//
// Logic mirrors parse_vacation_days() / process() in tools.py exactly:
// - Vacations sorted by start date
// - For each vacation, check if it ends before the current year's carryover
//   cutoff AND the previous year still has unused days → charge prev year first
// - If prev year's budget runs out mid-vacation, the remainder charges current year

function calculate(state) {
  // Build year objects keyed by year number
  const map = {};
  for (const y of state.years) {
    const num  = Number(y.year);
    const days = Number(y.allowedDays);
    if (!num || !days) continue;
    map[num] = {
      yearNum:     num,
      allowedDays: days,
      cutoffDay:   y.cutoffDay   || null,
      cutoffMonth: y.cutoffMonth || null,
      usedDays:    0,
      logs:        [],
    };
  }

  // Sort valid vacations chronologically (matching Python's file order)
  const vacations = state.vacations
    .filter(v => v.start && v.end && Number(v.days) > 0 && sameYear(v.start, v.end))
    .sort((a, b) => a.start.localeCompare(b.start));

  for (const vac of vacations) {
    const startDate = parseLocalDate(vac.start);
    const endDate   = parseLocalDate(vac.end);
    const vacYear   = startDate.getFullYear();
    const days      = Number(vac.days);

    const year     = map[vacYear];
    if (!year) continue;
    const prevYear = map[vacYear - 1] || null;

    const cutoff = (year.cutoffDay && year.cutoffMonth)
      ? new Date(vacYear, year.cutoffMonth - 1, year.cutoffDay, 0, 0, 0, 0)
      : null;

    if (cutoff && prevYear && endDate <= cutoff && prevYear.usedDays < prevYear.allowedDays) {
      const prevAdded = chargeDays(prevYear, vac, days, vacYear);
      if (prevAdded < days) {
        chargeDays(year, vac, days - prevAdded, vacYear);
      }
    } else {
      chargeDays(year, vac, days, vacYear);
    }
  }

  return map;
}

// Charge `days` against `yearObj`'s budget; return how many were actually added.
// `vacYear` is the calendar year of the vacation (may differ from yearObj.yearNum
// when a 2022 vacation charges against 2021's budget).
function chargeDays(yearObj, vac, days, vacYear) {
  const remaining = yearObj.allowedDays - yearObj.usedDays;
  const added = Math.max(0, Math.min(days, remaining));
  yearObj.usedDays += added;
  // Always log the vacation, even when it adds 0 days (budget already
  // exhausted) — computeYearStats() sums vac.days from these log entries, so
  // dropping the log here would make the vacation vanish entirely from the
  // year's displayed total and log instead of showing it as over budget.
  yearObj.logs.push({ vac, added, vacYear });
  return added;
}

// ── HTML escaping ────────────────────────────────────────────────────────────

// State can come from an imported PDF/JSON file, so any state-derived value
// must be escaped before it lands in an innerHTML template (attribute or text
// position) — otherwise a crafted import can break out of an attribute and
// inject arbitrary markup/script.
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    calculate, chargeDays, countWeekdays, parseLocalDate, fmtDate,
    parseCutoff, fmtCutoff, sameYear, escapeHtml,
  };
}
