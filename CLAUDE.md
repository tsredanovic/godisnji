# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Godisnji is a client-side-only vacation days tracker (`web-app/`): plain HTML/CSS/JS, no framework, no bundler, no package manager, no backend. All data lives in the browser's `localStorage`; there is no account system, sync, or network calls at runtime.

## Commands

There is no build, lint, or test tooling in this repo (by design — see the "no bundler" positioning in README.md).

- **Run locally**: open `web-app/index.html` directly in a browser, or serve the `web-app/` directory with any static file server (e.g. `python3 -m http.server`).
- **Verify changes**: there is no test suite or CI. Changes must be verified manually by exercising the app in a browser (add a year/vacation, check the Results panel, and check PDF export/import if those code paths were touched).

## Architecture

- **No modules/bundler** — every script runs in global scope. Load order in `index.html` matters: `vendor/pdf-lib.min.js` → `vendor/fontkit.umd.min.js` → `vendor/pdf-fonts.js` → `pdf-io.js` → `app.js`.
- **`app.js`** owns a single global `state` object (`{ years, vacations, profile }`), persisted to `localStorage` via `saveState()`/`loadState()`. `calculate()` computes each year's vacation usage, including cross-year carryover: `chargeDays()` charges a vacation against the previous year's leftover budget first if the vacation falls before that year's carryover cutoff date, then charges the remainder to its own year. Rendering is a manual, non-reactive pipeline — `render()` calls `renderYears()`/`renderVacations()`/`renderResults()` — re-triggered explicitly from input/click handlers (`onYearInput`, `onVacationInput`, `onYearsClick`, `onVacationsClick`).
- **`pdf-io.js`** handles PDF export/import on top of the vendored `pdf-lib`/`fontkit`. `exportPdf()` draws a report mirroring the Results view using `PdfReport`, a small hand-rolled layout helper around pdf-lib's low-level drawing API (manual page-break/positioning logic, not a templating layer), and embeds the full `state` as a hidden JSON file attachment inside the generated PDF. `importPdfFile()` reverses this (`extractEmbeddedJson`/`collectNameTreeLeaves`) to pull that attachment back out and restore `state`.

## Conventions

- Git workflow: work on a feature branch and merge directly into `main`.
- Releases are tagged with annotated tags: `git tag -a vX.Y.Z -m "<one-line description>"`. Keep the message in the same terse style as existing tags — check `git tag -l -n20` before writing a new one.
- The footer's `#app-version` span in `web-app/index.html` is a manually maintained version string (there's no build step to sync it) — bump it to match whatever version is being tagged.
- Deployed via Cloudflare Pages.
