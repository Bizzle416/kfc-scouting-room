// Finished-week results for all four teams, built from the day-by-day ESPN lineups.
// Shared by espn/sync.mjs and any one-off backfill so there's only one scoring rule.
// A week is final once every one of its game days is banked. ESPN's own category results win
// whenever ESPN has decided the matchup (stat corrections land there first); until then the
// result comes from the summed lineups and is marked provisional.
export const RAW = ["fgm", "fga", "ftm", "fta", "tpm", "reb", "ast", "stl", "blk", "to", "pts"];
export const CAT_KEYS = ["fgp", "ftp", "tpm", "reb", "ast", "stl", "blk", "to", "pts"];
const LOW = new Set(["to"]);
const onCourt = (r) => r[1] !== "BE" && r[1] !== "IR";
const val = (t, k) => (k === "fgp" ? (t.fga ? t.fgm / t.fga : 0) : k === "ftp" ? (t.fta ? t.ftm / t.fta : 0) : t[k]);

export function weekTotals(days, dates, team) {
  const o = Object.fromEntries(RAW.map((k) => [k, 0]));
  for (const d of dates) for (const r of days[d]?.[team] || []) if (onCourt(r)) RAW.forEach((k, i) => (o[k] += +r[2 + i] || 0));
  return o;
}

// Home team's view: one of W / L / T per category, in CAT_KEYS order.
export function catResults(a, b) {
  return CAT_KEYS.map((k) => {
    const x = val(a, k), y = val(b, k);
    if (Math.abs(x - y) < 1e-9) return "T";
    return (LOW.has(k) ? x < y : x > y) ? "W" : "L";
  });
}
export const tally = (cats) => [cats.filter((c) => c === "W").length, cats.filter((c) => c === "L").length, cats.filter((c) => c === "T").length];

// weeks: [{ w, dates: [...], pairs: [[home, away], ...], official: { "home|away": [cats] | undefined } }]
export function buildResults(days, weeks) {
  const out = [], warnings = [];
  for (const W of weeks) {
    if (!W.dates.length || !W.dates.every((d) => days[d])) continue; // not every night banked yet
    const matchups = W.pairs.map(([home, away]) => {
      const tot = { [home]: weekTotals(days, W.dates, home), [away]: weekTotals(days, W.dates, away) };
      const mine = catResults(tot[home], tot[away]), esp = W.official?.[`${home}|${away}`];
      const cats = esp && esp.every(Boolean) ? esp : mine;
      if (esp && esp.every(Boolean) && esp.join("") !== mine.join(""))
        warnings.push(`Week ${W.w} ${home} v ${away}: ESPN has ${esp.join("")}, summed lineups give ${mine.join("")} — using ESPN (stat correction?)`);
      return { home, away, cats, score: tally(cats), src: esp && esp.every(Boolean) ? "espn" : "lineups", tot };
    });
    out.push({ week: W.w, start: W.dates[0], end: W.dates[W.dates.length - 1], matchups });
  }
  return { results: out, warnings };
}

// The old single-team log (radio and awards read it): one row per finished week for `me`.
export function historyFor(results, me) {
  const h = [];
  for (const R of results) for (const m of R.matchups) {
    if (m.home !== me && m.away !== me) continue;
    const cats = m.home === me ? m.cats : m.cats.map((c) => ({ W: "L", L: "W", T: "T" })[c]);
    const [w, l, t] = tally(cats);
    h.push({ week: R.week, opp: m.home === me ? m.away : m.home, w, l, t, cats, src: m.src });
  }
  return h.sort((a, b) => a.week - b.week);
}
export function seasonFor(history) {
  const s = { w: 0, l: 0, t: 0, weeks: 0 };
  for (const h of history) if (h.week <= 18) { s.w += h.w; s.l += h.l; s.t += h.t; s.weeks++; }
  return s;
}
