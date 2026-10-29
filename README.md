# Fantasy Analytics

Gameweek analysis for a 4-team ESPN fantasy basketball league (9-category head-to-head, each category scored).

**Live site:** https://bizzle416.github.io/kfc-scouting-room/

## Tabs
- **Gameweek** (default): the league's week to date and the projection for the rest of the week.
  - *League this week*: every team's week-to-date category totals, ranked, with the score now, projected categories and win chance.
  - *One panel per matchup*: KPIs (score now, projected final, win chance, starts so far and left), a category table with win probabilities, starts per day (played vs projected), expected categories night by night, a day-by-day stat table, a player table (week totals, performance vs projection, starts left) and the lineup plan for the remaining days.
  - *Free agents for the rest of the week*, for the commissioner's team.
  - Past weeks can be selected; they show the final numbers.
- **Recap**: final category scores and the players who decided each matchup.
- **Bench audit**: tests every idle game in the lineup plan against legal swaps.
- **Season**: league table (charter seeding) and the commissioner's season.
- **Trade**: trade analyser, trade block (Supabase) and completed trades.
- **Players**: 9-cat z-score values and salaries.

## Data
`data/league.json` is rebuilt automatically by the **ESPN sync** GitHub Action (`espn/sync.mjs`), several times a day after US games finish. It reads ESPN with the `ESPN_S2` / `ESPN_SWID` repo secrets, since the league is private. A game day only counts once it's final. Run it by hand from Actions → ESPN sync → Run workflow.

Week to date is the sum of ESPN's nightly lineups (started games only). The Gameweek tab checks that this sum matches ESPN's live week totals and flags it if it doesn't.

## Model
- Per-game line per player: preseason FantasyPros projection blended with his ESPN season average, weighted by games played (`gp / (gp + 3)`: 50% actual at 3 games, 73% at 8, 87% at 20).
- Lineup plan: each remaining day, the best 10 available players fill PG, SG, SF, PF, C, G, F and 3 UTIL.
- 10,000 simulated finishes per matchup on top of the week-to-date totals.

## Files
- `index.html`: the whole app (no build step).
- `data/league.json`: rosters, salaries, ESPN stats, NBA schedule, every night's lineups and results for every finished week.
- `espn/sync.mjs`, `espn/results.mjs`: the ESPN sync and the scoring rule for finished weeks.
