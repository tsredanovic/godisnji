<div align="center">
  <img src="web-app/assets/favicon.svg" width="88" height="88" alt="Godisnji icon">

  # Godisnji

  **A vacation days tracker that runs entirely in your browser.**

  No install, no account, no server — open a file and go.

  [![Version](https://img.shields.io/github/v/tag/tsredanovic/godisnji?label=version&sort=semver)](https://github.com/tsredanovic/godisnji/tags)
  [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
  [![Dependencies: none](https://img.shields.io/badge/dependencies-none-brightgreen)](#tech-stack)
  [![Build: not required](https://img.shields.io/badge/build-not%20required-lightgrey)](#getting-started)
</div>

---

*"Godišnji [odmor]" is Croatian for "annual [leave]" — the paid vacation days most employees accrue every year.*

## Contents

- [Features](#features)
- [Getting started](#getting-started)
- [How carryover works](#how-carryover-works)
- [Exporting & importing](#exporting--importing)
- [Data & privacy](#data--privacy)
- [Tech stack](#tech-stack)
- [Project structure](#project-structure)
- [License](#license)

## Features

- **Per-year allowances** — configure how many vacation days you get for each year.
- **Carryover cutoff** — unused days from the previous year roll over automatically and get spent first, up to a configurable `DD.MM` cutoff date, exactly like most employers' "use it or lose it by end of Q1" policies.
- **Automatic weekday counting** — enter a vacation's start/end date and the number of working days (Mon–Fri) is computed for you, with the option to override it manually.
- **Cross-year vacation splitting** — a vacation that starts before the cutoff automatically draws down last year's remaining balance first, then charges the rest to the current year — and the results view shows exactly how many days came from which year.
- **Results dashboard** — a collapsible card per year with a color-coded progress bar (used vs. allowed) and a full log of every vacation counted against it.
- **Validation at a glance** — rows where a vacation's start and end land in different years are flagged with an inline error badge.
- **Profile** — set your name and employer; your initials show up as an avatar and both appear in the PDF export.
- **PDF export** — generate a polished, print-ready PDF of your results, right down to matching the web UI's colors and layout, with full Unicode support (e.g. Croatian ć/č/š/ž/đ) via an embedded font.
- **PDF import** — every exported PDF carries your full data set as a hidden attachment, so you can back it up or hand it to another device/browser and import it straight back in.
- **Reset to defaults** — restore example data any time (with a confirmation prompt), without losing your profile.
- **Responsive UI** — a collapsible header menu keeps things usable on mobile.

## Getting started

There's nothing to install and nothing to build.

```bash
git clone https://github.com/tsredanovic/godisnji.git
open godisnji/web-app/index.html
```

Or simply download `web-app/index.html` (with its sibling files) and double-click it. Any modern browser works.

## How carryover works

Each year has an **allowed days** budget and an optional **carryover cutoff** (e.g. `30.06`). When you log a vacation:

1. If the vacation ends on or before that year's cutoff *and* the previous year still has unused days, it's charged against the previous year's leftover balance first.
2. Once that balance runs out (or the vacation ends after the cutoff), the remaining days are charged to the vacation's own year.

This mirrors how a lot of workplaces handle "carry over N days into Q1" policies without you having to do the math yourself — the results view breaks out exactly how many days came from each year's budget.

## Exporting & importing

- **Export PDF** renders your current results (per-year progress and vacation log) into a shareable PDF, and silently embeds your full state as a JSON attachment inside it.
- **Import PDF** reads that attachment back out of a previously exported PDF and restores years, vacations, and profile — a simple way to move your data between browsers/devices or keep an offline backup, without any account or sync service.

## Data & privacy

All data lives in your browser's `localStorage` — nothing is ever sent to a server. There's no account, no analytics, no tracking scripts, and no cookies. Clearing your browser data (or using a different browser/device) starts you fresh, which is exactly what PDF export is for.

## Tech stack

Plain HTML, CSS, and JavaScript — no framework, no bundler, no package manager.

- [pdf-lib](https://github.com/Hopding/pdf-lib) and [fontkit](https://github.com/foliojs/fontkit) (vendored in `web-app/vendor/`) power the PDF export/import feature.
- Everything else — state, rendering, date math — is hand-written vanilla JS.

## Project structure

```
web-app/
├── index.html        # markup/layout
├── style.css         # all styling
├── app.js            # state, calculations, rendering, event handling
├── pdf-io.js         # PDF export/import
├── assets/
│   └── favicon.svg   # app icon
└── vendor/           # third-party libs used only for PDF export/import
```

## License

MIT — see [LICENSE](LICENSE).
