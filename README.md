# KFC Scouting Room

Matchup predictor and league analysis for the KFC Fantasy Cup (ESPN, 4 teams, 9-cat H2H each category).

**Live site:** https://YOUR-USERNAME.github.io/kfc-scouting-room/

## Updating (commissioner)
1. Save the KFC workbook.
2. Open the site → **Update data** → load the workbook (read in the browser only) → **Download league.json**.
3. In this repo: `data/` → Add file → Upload files → `league.json` → Commit.

The workbook itself never goes in this repo — it holds sealed keeper plans.

## Files
- `index.html` — the whole app (no build step).
- `data/league.json` — rosters, salaries, ESPN stats, NBA schedule, matchup log.
