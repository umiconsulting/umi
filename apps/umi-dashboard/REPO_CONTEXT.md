# Dashboard Repo Context

## Purpose

Umi owner dashboard app shell with live product data.

## Load first

1. `AGENTS.md`
2. `Umi Dash.html`
3. `src/app.jsx`
4. `src/shell.jsx`
5. Relevant file under `src/screens/`
6. `src/styles.css`

## High-authority files

- `Umi Dash.html`
- `src/screens/`
- `src/app.jsx`
- `src/shell.jsx`
- `src/styles.css`
- `AGENTS.md`

## Runtime boundary

The dashboard reads live data through the dashboard server/API layer. Its screens and functions define expected owner-dashboard behavior, but backend data ownership remains with the appropriate product repo.

## Production rule

When expanding live-data coverage, preserve the existing functions and workflows unless the user explicitly changes the product requirements.

## Avoid by default

- Treating dashboard fields as schema authority.
- Moving backend ownership into this repo solely because the dashboard displays the data.
