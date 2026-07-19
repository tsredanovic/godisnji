'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calculate, countWeekdays, fmtDate, parseCutoff, fmtCutoff, sameYear, escapeHtml,
} = require('../web-app/calc.js');

// ── countWeekdays ────────────────────────────────────────────────────────────

test('countWeekdays counts Mon-Fri inclusive, skipping weekends', () => {
  // Mon 2026-01-05 .. Fri 2026-01-09 → 5 weekdays
  assert.equal(countWeekdays('2026-01-05', '2026-01-09'), 5);
  // Sat 2026-01-10 .. Sun 2026-01-11 → 0 weekdays
  assert.equal(countWeekdays('2026-01-10', '2026-01-11'), 0);
  // Fri 2026-01-09 .. Mon 2026-01-12 spans a weekend → 2 weekdays
  assert.equal(countWeekdays('2026-01-09', '2026-01-12'), 2);
});

test('countWeekdays returns 0 for invalid or reversed ranges', () => {
  assert.equal(countWeekdays('', '2026-01-09'), 0);
  assert.equal(countWeekdays('2026-01-09', ''), 0);
  assert.equal(countWeekdays('2026-01-09', '2026-01-05'), 0);
});

// ── date/cutoff formatting ───────────────────────────────────────────────────

test('fmtDate converts YYYY-MM-DD to DD.MM.YYYY', () => {
  assert.equal(fmtDate('2026-07-19'), '19.07.2026');
  assert.equal(fmtDate(''), '');
});

test('parseCutoff/fmtCutoff round-trip valid DD.MM strings', () => {
  assert.deepEqual(parseCutoff('30.06'), { day: 30, month: 6 });
  assert.equal(fmtCutoff(30, 6), '30.06');
});

test('parseCutoff rejects malformed or out-of-range input', () => {
  assert.deepEqual(parseCutoff(''), { day: null, month: null });
  assert.deepEqual(parseCutoff('abc'), { day: null, month: null });
  assert.deepEqual(parseCutoff('32.01'), { day: null, month: null });
  assert.deepEqual(parseCutoff('01.13'), { day: null, month: null });
});

test('fmtCutoff returns empty string when day or month is missing', () => {
  assert.equal(fmtCutoff(null, 6), '');
  assert.equal(fmtCutoff(30, null), '');
});

// ── sameYear / escapeHtml ────────────────────────────────────────────────────

test('sameYear compares the year portion of two date strings', () => {
  assert.equal(sameYear('2026-01-01', '2026-12-31'), true);
  assert.equal(sameYear('2026-12-31', '2027-01-01'), false);
  assert.equal(sameYear('', '2026-01-01'), true); // missing side is treated as "no conflict"
});

test('escapeHtml escapes all five reserved characters', () => {
  assert.equal(escapeHtml(`<a href="x">&'</a>`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.equal(escapeHtml(null), '');
});

// ── calculate() / chargeDays() carryover logic ──────────────────────────────

test('calculate charges a vacation fully within its own year budget', () => {
  const map = calculate({
    years: [{ id: 'y1', year: 2026, allowedDays: 20, cutoffDay: null, cutoffMonth: null }],
    vacations: [{ id: 'v1', start: '2026-03-01', end: '2026-03-05', days: 5 }],
  });
  assert.equal(map[2026].usedDays, 5);
  assert.equal(map[2026].logs.length, 1);
  assert.equal(map[2026].logs[0].added, 5);
});

test('calculate caps usedDays at the allowance when a vacation overshoots it', () => {
  const map = calculate({
    years: [{ id: 'y1', year: 2026, allowedDays: 3, cutoffDay: null, cutoffMonth: null }],
    vacations: [{ id: 'v1', start: '2026-03-01', end: '2026-03-05', days: 5 }],
  });
  assert.equal(map[2026].usedDays, 3);
  assert.equal(map[2026].logs[0].added, 3); // logged even though it exceeds budget
});

test('calculate charges against the previous year first when before the cutoff', () => {
  const map = calculate({
    years: [
      { id: 'y1', year: 2025, allowedDays: 20, cutoffDay: null, cutoffMonth: null },
      { id: 'y2', year: 2026, allowedDays: 20, cutoffDay: 30, cutoffMonth: 6 },
    ],
    vacations: [{ id: 'v1', start: '2026-02-01', end: '2026-02-05', days: 5 }],
  });
  assert.equal(map[2025].usedDays, 5);
  assert.equal(map[2026].usedDays, 0);
  assert.equal(map[2025].logs[0].vacYear, 2026); // logged under 2025 but tagged with the vacation's real year
});

test('calculate splits a vacation across years when the previous year budget runs out mid-vacation', () => {
  const map = calculate({
    years: [
      { id: 'y1', year: 2025, allowedDays: 2, cutoffDay: null, cutoffMonth: null },
      { id: 'y2', year: 2026, allowedDays: 20, cutoffDay: 30, cutoffMonth: 6 },
    ],
    vacations: [{ id: 'v1', start: '2026-02-01', end: '2026-02-05', days: 5 }],
  });
  assert.equal(map[2025].usedDays, 2); // remaining 2025 budget exhausted first
  assert.equal(map[2026].usedDays, 3); // remainder charged to 2026
});

test('calculate charges the current year when the vacation ends after the cutoff', () => {
  const map = calculate({
    years: [
      { id: 'y1', year: 2025, allowedDays: 20, cutoffDay: null, cutoffMonth: null },
      { id: 'y2', year: 2026, allowedDays: 20, cutoffDay: 30, cutoffMonth: 6 },
    ],
    vacations: [{ id: 'v1', start: '2026-07-01', end: '2026-07-05', days: 5 }],
  });
  assert.equal(map[2025].usedDays, 0);
  assert.equal(map[2026].usedDays, 5);
});

test('calculate ignores vacations whose start and end land in different years', () => {
  const map = calculate({
    years: [{ id: 'y1', year: 2026, allowedDays: 20, cutoffDay: null, cutoffMonth: null }],
    vacations: [{ id: 'v1', start: '2026-12-29', end: '2027-01-02', days: 5 }],
  });
  assert.equal(map[2026].usedDays, 0);
  assert.equal(map[2026].logs.length, 0);
});

test('calculate includes a year with allowedDays explicitly set to 0, capping any vacation at 0 added days', () => {
  const map = calculate({
    years: [{ id: 'y1', year: 2026, allowedDays: 0, cutoffDay: null, cutoffMonth: null }],
    vacations: [{ id: 'v1', start: '2026-03-01', end: '2026-03-05', days: 5 }],
  });
  assert.ok(map[2026]); // year must not be dropped just because its allowance is 0
  assert.equal(map[2026].usedDays, 0);
  assert.equal(map[2026].logs.length, 1);
  assert.equal(map[2026].logs[0].added, 0);
});
