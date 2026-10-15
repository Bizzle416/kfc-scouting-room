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

## Fryer Radio (audio previews and reviews)
Kev (hype) and Nigel (dry analyst) talk through each week. Free, automatic, and built only from this repo's data.

**How it runs:** every time `data/league.json` is uploaded, the *Fryer Radio* GitHub Action:
1. Runs the site's own sim code (straight out of `index.html`, seeded so it's repeatable) for both matchups.
2. Makes a **preview** for the current week if there isn't one yet. Once made it's frozen, so the model can be graded later.
3. Makes a **review** for any finished week in the Matchup Log, grading the frozen preview against the result.
4. Voices it with Kokoro (open-source, runs inside the Action, no account) and commits the mp3 to `radio/episodes/`.
5. The player at the top of *This week* plays the latest episode, with a transcript.

**Timing:** upload before the first game of the week → preview. Upload once the week's row in the Matchup Log is complete → review (and next week's preview in the same run).

**Optional punch-up:** add a free Google Gemini key as a repo secret named `GEMINI_API_KEY` (Settings → Secrets and variables → Actions). Gemini rewrites the jokes, but any rewrite that contains a number not in the original script is thrown away and the template script is used instead. No key = template script, same facts.

**Files:** `radio/engine.mjs` (runs the sims), `radio/writer.mjs` (the script), `radio/storylines.json` (running jokes — edit these), `radio/tts.py` (voices), `radio/build.mjs` (puts it together).

**Re-run by hand:** Actions → Fryer Radio → Run workflow (tick *force* to remake this week's preview).

**Limits:** only the commissioner's game has logged results, so reviews only cover that game. Each episode is about 1.5 MB.
