'use strict';

const STORAGE_KEY = 'godisnji';

// ── Default data ─────────────────────────────────────────────────────────────

const DEFAULT_YEARS = [
  { id: 'dy1', year: 2025, allowedDays: 20, cutoffDay: 30, cutoffMonth: 6 },
  { id: 'dy2', year: 2026, allowedDays: 25, cutoffDay: 31, cutoffMonth: 12 },
];

const DEFAULT_VACATIONS = [
  { id: 'dv1', start: '2025-02-24', end: '2025-02-28', days: 5  },
  { id: 'dv2', start: '2025-06-18', end: '2025-06-20', days: 2  },
  { id: 'dv3', start: '2025-07-14', end: '2025-07-25', days: 10 },
  { id: 'dv4', start: '2026-01-05', end: '2026-01-09', days: 4  },
  { id: 'dv5', start: '2026-04-27', end: '2026-04-28', days: 2  },
  { id: 'dv6', start: '2026-05-11', end: '2026-05-12', days: 2  },
  { id: 'dv7', start: '2026-07-13', end: '2026-07-17', days: 5  },
  { id: 'dv8', start: '2026-07-27', end: '2026-08-07', days: 10 },
];

// ── State ────────────────────────────────────────────────────────────────────

let state = { years: [], vacations: [] };

let _idSeq = 0;
function uid() {
  return 'id' + (++_idSeq) + '_' + Math.random().toString(36).slice(2, 6);
}

// ── Storage ──────────────────────────────────────────────────────────────────

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed?.years) || !Array.isArray(parsed?.vacations)) {
        throw new Error('bad shape');
      }
      state = parsed;
      return;
    }
  } catch (_) {}
  state = {
    years: DEFAULT_YEARS.map(y => ({ ...y })),
    vacations: DEFAULT_VACATIONS.map(v => ({ ...v })),
  };
}

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

function calculate() {
  // Build year objects keyed by year number
  const map = {};
  for (const y of state.years) {
    const num  = Number(y.year);
    const days = Number(y.allowedDays);
    if (!num || !days) continue;
    map[num] = {
      yearNum:     num,
      allowedDays: days,
      hasCutoff:   !!(y.cutoffDay && y.cutoffMonth),
      cutoffDay:   y.cutoffDay   || 31,
      cutoffMonth: y.cutoffMonth || 12,
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

    const cutoff = year.hasCutoff
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
  const added = Math.min(days, remaining);
  if (added > 0) {
    yearObj.usedDays += added;
    yearObj.logs.push({ vac, added, vacYear });
  }
  return added;
}

// ── Render helpers ───────────────────────────────────────────────────────────

let _renderTimer = null;

function scheduleResultsRender() {
  clearTimeout(_renderTimer);
  _renderTimer = setTimeout(renderResults, 150);
}

// ── Render: Years table ──────────────────────────────────────────────────────

function renderYears() {
  const tbody = document.getElementById('years-body');
  tbody.innerHTML = '';
  for (const y of state.years) {
    const tr = document.createElement('tr');
    tr.dataset.id = y.id;
    tr.innerHTML = `
      <td><input type="number" class="inp-year" value="${y.year ?? ''}" placeholder="2024"
            min="2000" max="2099" data-id="${y.id}" data-field="year"></td>
      <td><input type="number" class="inp-days" value="${y.allowedDays ?? ''}" placeholder="25"
            min="1" max="365" data-id="${y.id}" data-field="allowedDays"></td>
      <td><input type="text" class="inp-cutoff" value="${fmtCutoff(y.cutoffDay, y.cutoffMonth)}"
            placeholder="31.12" maxlength="5" data-id="${y.id}" data-field="cutoff"></td>
      <td><button class="btn-remove" data-id="${y.id}" title="Remove year">×</button></td>
    `;
    tbody.appendChild(tr);
  }
}

// ── Render: Vacations table ──────────────────────────────────────────────────

function renderVacations() {
  const tbody = document.getElementById('vacations-body');
  tbody.innerHTML = '';
  for (const v of state.vacations) {
    const invalid = v.start && v.end && !sameYear(v.start, v.end);
    const tr = document.createElement('tr');
    if (invalid) tr.classList.add('row-error');
    tr.dataset.id = v.id;
    tr.innerHTML = `
      <td><input type="date" value="${v.start || ''}" data-id="${v.id}" data-field="start"></td>
      <td><input type="date" value="${v.end   || ''}" data-id="${v.id}" data-field="end"></td>
      <td>${buildDaysCell(v.id, v.days, invalid)}</td>
      <td><button class="btn-remove" data-id="${v.id}" title="Remove vacation">×</button></td>
    `;
    tbody.appendChild(tr);
  }
}

function buildDaysCell(id, days, invalid) {
  const badge = invalid
    ? `<span class="err-badge" title="Start and end must be in the same year">!</span>`
    : '';
  return `<div class="days-cell">
    <input type="number" class="inp-vdays" value="${days ?? ''}"
      min="0" max="365" data-id="${id}" data-field="days">
    ${badge}
  </div>`;
}

// ── Render: Results ──────────────────────────────────────────────────────────

function renderResults() {
  const container = document.getElementById('results-container');

  // Remember which year cards the user has collapsed
  const collapsed = new Set();
  container.querySelectorAll('.year-card[data-year]').forEach(card => {
    if (!card.querySelector('details[open]')) {
      collapsed.add(Number(card.dataset.year));
    }
  });

  const yearsMap  = calculate();
  const yearNums  = Object.keys(yearsMap).map(Number).sort((a, b) => a - b);

  if (!yearNums.length) {
    container.innerHTML = '<p class="no-data">Add year configurations to see results.</p>';
    return;
  }

  container.innerHTML = '';
  for (const yearNum of yearNums) {
    const yr   = yearsMap[yearNum];
    const card = buildYearCard(yr, yearNum);
    if (collapsed.has(yearNum)) {
      card.querySelector('details').removeAttribute('open');
    }
    container.appendChild(card);
  }
}

function buildYearCard(yr, yearNum) {
  const remaining = yr.allowedDays - yr.usedDays;
  const pct       = yr.allowedDays
    ? Math.min(100, Math.round((yr.usedDays / yr.allowedDays) * 100))
    : 0;
  const barClass  = pct >= 100 ? 'p-full' : pct >= 90 ? 'p-high' : pct >= 70 ? 'p-mid' : 'p-low';
  const remClass  = remaining <= 0 ? (remaining < 0 ? 's-over' : 's-zero') : '';

  const card = document.createElement('div');
  card.className = 'year-card';
  card.dataset.year = yearNum;
  card.innerHTML = `
    <details open>
      <summary>
        <div class="card-header">
          <div class="card-title">
            <span class="toggle-icon">&#9654;</span>
            <span class="card-year">${yearNum}</span>
          </div>
          <div class="card-stats">
            <span class="stat-allowed">${yr.allowedDays} allowed</span>
            <span class="stat-used">${yr.usedDays} used</span>
            <span class="stat-remaining ${remClass}">${Math.max(0, remaining)} left</span>
          </div>
        </div>
        <div class="progress-bar">
          <div class="progress-fill ${barClass}" style="width:${pct}%"></div>
        </div>
      </summary>
      ${buildLogHtml(yr.logs, yearNum)}
    </details>
  `;
  return card;
}

function buildLogHtml(logs, yearNum) {
  if (!logs.length) return '<p class="no-logs">No vacations recorded.</p>';

  const items = logs.map(log => {
    const isCross = log.vacYear !== yearNum;
    const tag = isCross
      ? `<span class="cross-tag">from ${log.vacYear}</span>`
      : '';
    const daysLabel = log.added === 1 ? '1 day' : `${log.added} days`;
    return `<li>
      <span class="log-date">${fmtDate(log.vac.start)}&ndash;${fmtDate(log.vac.end)}</span>
      <span class="log-days">${daysLabel}</span>
      ${tag}
    </li>`;
  }).join('');

  return `<ul class="vac-log">${items}</ul>`;
}

// ── Full render ──────────────────────────────────────────────────────────────

function render() {
  renderYears();
  renderVacations();
  renderResults();
}

// ── Event handlers ───────────────────────────────────────────────────────────

function onYearInput(e) {
  const { id, field } = e.target.dataset;
  if (!id || !field) return;
  const y = state.years.find(y => y.id === id);
  if (!y) return;

  if (field === 'cutoff') {
    const { day, month } = parseCutoff(e.target.value);
    y.cutoffDay   = day;
    y.cutoffMonth = month;
  } else {
    y[field] = e.target.value !== '' ? Number(e.target.value) : null;
  }
  // Don't persist a null allowedDays — if the user is mid-edit (cleared the
  // field before typing the new value) we keep the old stored value so a
  // reload doesn't permanently drop the year from results.
  if (field !== 'allowedDays' || y.allowedDays != null) saveState();
  scheduleResultsRender();
}

function onVacationInput(e) {
  const el = e.target;
  const { id, field } = el.dataset;
  if (!id || !field) return;
  const v = state.vacations.find(v => v.id === id);
  if (!v) return;

  if (field === 'start' || field === 'end') {
    v[field] = el.value || null;

    const invalid = !!(v.start && v.end && !sameYear(v.start, v.end));
    if (!invalid && v.start && v.end) {
      v.days = countWeekdays(v.start, v.end);
    }

    const row = document.querySelector(`#vacations-body tr[data-id="${id}"]`);
    if (row) {
      row.classList.toggle('row-error', invalid);
      const td = row.querySelectorAll('td')[2];
      const hasBadge = !!td?.querySelector('.err-badge');
      if (invalid !== hasBadge) {
        // Error badge added/removed — must rebuild the cell
        if (td) td.innerHTML = buildDaysCell(id, v.days, invalid);
      } else {
        // Error state unchanged — update days value in place (preserves focus)
        const daysInput = td?.querySelector('.inp-vdays');
        if (daysInput) daysInput.value = v.days ?? '';
      }
    }
  } else if (field === 'days') {
    v.days = el.value !== '' ? Number(el.value) : 0;
  }
  saveState();
  scheduleResultsRender();
}

function onYearsClick(e) {
  if (!e.target.classList.contains('btn-remove')) return;
  const id = e.target.dataset.id;
  state.years = state.years.filter(y => y.id !== id);
  saveState();
  renderYears();
  renderResults();
}

function onVacationsClick(e) {
  if (!e.target.classList.contains('btn-remove')) return;
  const id = e.target.dataset.id;
  state.vacations = state.vacations.filter(v => v.id !== id);
  saveState();
  renderVacations();
  renderResults();
}

function addYear() {
  const maxYear = state.years.reduce((max, y) => Math.max(max, Number(y.year) || 0), 0);
  const nextYear = maxYear ? maxYear + 1 : null;
  state.years.push({ id: uid(), year: nextYear, allowedDays: 20, cutoffDay: 31, cutoffMonth: 12 });
  saveState();
  renderYears();
  renderResults();
  // Focus the year input of the new (last sorted) row
  const rows = document.querySelectorAll('#years-body tr');
  if (rows.length) rows[rows.length - 1].querySelector('input')?.focus();
}

function addVacation() {
  state.vacations.push({ id: uid(), start: null, end: null, days: 0 });
  saveState();
  renderVacations();
  renderResults();
  // Focus the start date of the new row (unsorted rows appear at the bottom)
  const rows = document.querySelectorAll('#vacations-body tr');
  if (rows.length) rows[rows.length - 1].querySelector('input')?.focus();
}

function resetToDefaults() {
  if (!confirm('Reset all data to defaults from vacation.txt? This cannot be undone.')) return;
  state = {
    years:     DEFAULT_YEARS.map(y => ({ ...y })),
    vacations: DEFAULT_VACATIONS.map(v => ({ ...v })),
  };
  saveState();
  render();
}

// ── Sort ─────────────────────────────────────────────────────────────────────

function sortYears() {
  state.years.sort((a, b) => (Number(a.year) || 0) - (Number(b.year) || 0));
  saveState();
  renderYears();
}

function sortVacations() {
  state.vacations.sort((a, b) =>
    (a.start || '9999-99-99').localeCompare(b.start || '9999-99-99')
  );
  saveState();
  renderVacations();
}

// ── Init ─────────────────────────────────────────────────────────────────────

function init() {
  loadState();

  document.getElementById('years-body').addEventListener('input', onYearInput);
  document.getElementById('years-body').addEventListener('click', onYearsClick);
  document.getElementById('vacations-body').addEventListener('input', onVacationInput);
  document.getElementById('vacations-body').addEventListener('click', onVacationsClick);
  document.getElementById('add-year-btn').addEventListener('click', addYear);
  document.getElementById('add-vacation-btn').addEventListener('click', addVacation);
  document.getElementById('sort-years-btn').addEventListener('click', sortYears);
  document.getElementById('sort-vacations-btn').addEventListener('click', sortVacations);
  document.getElementById('reset-btn').addEventListener('click', resetToDefaults);

  render();
}

init();
