// ESPN Fantasy -> data/league.json
// Reads the KFC league straight from ESPN (lineups, rosters, stats, both matchups) and keeps the
// workbook-only fields (salaries, dead cap, keeper rules, NBA schedule) from the current league.json.
// Always writes data/espn-status.json so a run can be checked without reading Action logs.
// Never prints or writes the cookies.
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const LEAGUE_ID = process.env.ESPN_LEAGUE_ID || "1143837492";
const SEASON = +(process.env.ESPN_SEASON || 2027);           // ESPN names the 2026-27 season 2027
const DAY1 = process.env.ESPN_DAY1 || "2026-10-20";          // scoring period 1 (US date)
const S2 = (process.env.ESPN_S2 || "").trim(), SWID = (process.env.ESPN_SWID || "").trim();
const TEAM_IDS = { 1: "Mamba", 2: "Danna", 3: "Bizzle", 4: "Slav" }; // ESPN team ids never change; names do
const TEAMS = ["Bizzle", "Danna", "Mamba", "Slav"];
const ME = "Bizzle";
// ESPN basketball stat ids
const SID = { pts: 0, blk: 1, stl: 2, ast: 3, reb: 6, to: 11, fgm: 13, fga: 14, ftm: 15, fta: 16, tpm: 17, min: 40, gp: 42 };
const RAW = ["fgm", "fga", "ftm", "fta", "tpm", "reb", "ast", "stl", "blk", "to", "pts"];
const CAT_IDS = [["fgp", 19], ["ftp", 20], ["tpm", 17], ["reb", 6], ["ast", 3], ["stl", 2], ["blk", 1], ["to", 11], ["pts", 0]];
const BENCH = new Set([12, 13]), IR_SLOT = 13;
const SLOT = { 0: "PG", 1: "SG", 2: "SF", 3: "PF", 4: "C", 5: "G", 6: "F", 11: "UTIL", 12: "BE", 13: "IR" };
const ALIAS = { "alex sarr": "alexandre sarr", "nicolas claxton": "nic claxton" }; // ESPN spelling -> site spelling

const norm = (s) => String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[.'’]/g, "").replace(/\s+/g, " ").trim();
const addDays = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const spDate = (sp) => addDays(DAY1, sp - 1);
const status = { ok: false, at: new Date().toISOString(), league: LEAGUE_ID, season: SEASON, steps: [], warnings: [], checks: {} };
const statusPath = path.join(ROOT, "data", "espn-status.json");
const step = (s) => status.steps.push(s);

async function get(params, extra = {}) {
  const url = `${process.env.ESPN_BASE || "https://lm-api-reads.fantasy.espn.com"}/apis/v3/games/fba/seasons/${SEASON}/segments/0/leagues/${LEAGUE_ID}?${params}`;
  const headers = { Accept: "application/json", "User-Agent": "kfc-scouting-room-sync", ...extra };
  if (S2 && SWID) headers.Cookie = `espn_s2=${S2}; SWID=${SWID}`;
  for (let i = 0; i < 3; i++) {
    const r = await fetch(url, { headers, redirect: "follow" });
    const txt = await r.text();
    if (r.ok) { try { return JSON.parse(txt); } catch { throw new Error(`ESPN sent non-JSON (${txt.slice(0, 80).replace(/\s+/g, " ")}) — usually means the cookies were rejected`); } }
    if (r.status === 401 || r.status === 403) throw new Error(`ESPN refused access (HTTP ${r.status}). The ESPN_S2 / ESPN_SWID secrets are missing, wrong or expired.`);
    if (i === 2) throw new Error(`ESPN HTTP ${r.status}`);
    await new Promise((res) => setTimeout(res, 2000 * (i + 1)));
  }
}
const statLine = (st) => { const o = {}; for (const k of RAW) o[k] = +(st?.[SID[k]] || 0); return o; };

async function main() {
  if (!S2 || !SWID) throw new Error("ESPN_S2 / ESPN_SWID secrets are not set in GitHub → Settings → Secrets and variables → Actions.");
  const prev = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "league.json"), "utf8"));

  const L = await get("view=mTeam&view=mRoster&view=mSettings&view=mStatus&view=mMatchupScore&view=mScoreboard");
  step("league read");
  const teamName = (t) => t.name || `${t.location || ""} ${t.nickname || ""}`.trim();
  const idToKey = {};
  for (const t of L.teams || []) { const k = TEAM_IDS[t.id]; if (k) idToKey[t.id] = k; }
  status.checks.teamNames = Object.fromEntries((L.teams || []).filter((t) => TEAM_IDS[t.id]).map((t) => [TEAM_IDS[t.id], teamName(t).trim()]));
  status.checks.espnTeams = (L.teams || []).map((t) => `${t.id}:${teamName(t)}`);
  if (Object.keys(idToKey).length !== 4) throw new Error(`Couldn't match all 4 ESPN team names: ${status.checks.espnTeams.join(", ")}`);

  const curSP = +(L.scoringPeriodId || L.status?.currentScoringPeriod || 1);
  const latestSP = +(L.status?.latestScoringPeriod || curSP);
  const curMP = +(L.status?.currentMatchupPeriod || 1);
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const REFW = JSON.parse(html.match(/const REF=(\{.*?\});\n/s)[1]).weeks || [];
  const spOf = (iso) => Math.round((Date.parse(iso + "T00:00:00Z") - Date.parse(DAY1 + "T00:00:00Z")) / 864e5) + 1;
  const mps = {}; for (const w of REFW) mps[String(w.w)] = Array.from({ length: w.days }, (_, i) => spOf(w.start) + i);
  status.checks.period = { currentScoringPeriod: curSP, latestScoringPeriod: latestSP, currentMatchupPeriod: curMP, mp1: mps["1"], today: spDate(curSP) };
  const mpFirstDate = (mp) => spDate((mps[String(mp)] || [1])[0]);
  const mpDays = (mp) => (mps[String(mp)] || []);

  // ----- rosters, with salaries carried from the current league.json -----
  const prevBy = new Map();
  for (const t of TEAMS) for (const p of prev.teams?.[t] || []) prevBy.set(p.id ? `id:${p.id}` : norm(p.n), { ...p, team: t }), prevBy.set(norm(p.n), { ...p, team: t });
  const seen = new Set(), teams = {}, espn = {}, added = [], moved = [];
  for (const t of L.teams) {
    const key = idToKey[t.id]; teams[key] = [];
    for (const e of t.roster?.entries || []) {
      const pl = e.playerPoolEntry?.player || {}, id = e.playerId || pl.id, en = pl.fullName || "?";
      const nk = ALIAS[norm(en)] || norm(en);
      const old = prevBy.get(`id:${id}`) || prevBy.get(nk);
      const n = old ? old.n : en;
      const salary = old ? old.salary : 5;
      if (!old) added.push(`${key}: ${en} ($5 FA)`); else if (old.team !== key) moved.push(`${en}: ${old.team} → ${key} ($${salary})`);
      const st = e.lineupSlotId === IR_SLOT ? "ir" : (pl.injuryStatus === "OUT" ? "out" : "active");
      teams[key].push({ n, salary, status: st, id, inj: pl.injuryStatus && pl.injuryStatus !== "ACTIVE" ? pl.injuryStatus : undefined });
      seen.add(norm(n));
      const tot = (pl.stats || []).find((s) => s.seasonId === SEASON && s.statSourceId === 0 && s.statSplitTypeId === 0);
      const gp = +(tot?.stats?.[SID.gp] || 0);
      if (gp > 0) { const line = statLine(tot.stats), o = { gp, min: +(tot.stats[SID.min] || 0) / gp }; for (const k of RAW) o[k] = line[k] / gp; espn[norm(n)] = o; }
    }
  }
  // ----- injuries for every player the site shows: ESPN's own status, not the preseason list -----
  const injuries = {}, siteName = (en) => { const nk = ALIAS[norm(en)] || norm(en); return nk; };
  for (const t of L.teams) for (const e of t.roster?.entries || []) { const pl = e.playerPoolEntry?.player || {}; if (pl.injuryStatus && pl.injuryStatus !== "ACTIVE") injuries[siteName(pl.fullName)] = pl.injuryStatus; }
  let poolN = 0;
  try {
    const P = await get("view=kona_player_info", { "X-Fantasy-Filter": JSON.stringify({ players: { limit: 750, sortPercOwned: { sortPriority: 1, sortAsc: false } } }) });
    for (const x of P.players || []) { const pl = x.player || {}; poolN++; if (pl.injuryStatus && pl.injuryStatus !== "ACTIVE") injuries[siteName(pl.fullName)] = pl.injuryStatus; }
  } catch (e) { status.warnings.push("Couldn't read ESPN's player pool for free-agent injuries: " + e.message); }
  status.checks.injuries = { poolPlayers: poolN, flagged: Object.keys(injuries).length, sample: Object.entries(injuries).slice(0, 12) };
  if (poolN < 200) status.warnings.push(`ESPN player pool only returned ${poolN} players — free-agent injury tags may be incomplete.`);

  // dropped = on a roster last sync, on no roster now. Salary stays as dead cap this season.
  const dead = { ...(prev.dead || {}) }, dropped = {}; for (const t of TEAMS) { dead[t] = +(dead[t] || 0); dropped[t] = [...(prev.dropped?.[t] || [])]; }
  const gone = [];
  for (const t of TEAMS) for (const p of prev.teams?.[t] || []) if (!seen.has(norm(p.n))) gone.push({ t, p });
  if (gone.length > 4) { status.warnings.push(`${gone.length} players vanished in one sync — looks like a name mismatch, not real drops. Dead cap NOT applied: ${gone.map((g) => g.p.n).join(", ")}`); }
  else for (const { t, p } of gone) { dead[t] += +p.salary || 0; if (!dropped[t].includes(norm(p.n))) dropped[t].push(norm(p.n)); }
  status.checks.rosterChanges = { added, moved, dropped: gone.map((g) => `${g.t}: ${g.p.n} ($${g.p.salary} dead)`) };

  // ----- stat sanity: 2*FGM + 3PM + FTM must equal PTS for every player -----
  const bad = Object.entries(espn).filter(([, a]) => Math.abs(2 * a.fgm + a.tpm + a.ftm - a.pts) > 0.01).map(([k]) => k);
  status.checks.espnPlayers = Object.keys(espn).length;
  if (bad.length) throw new Error(`Stat ids look wrong (points don't add up) for: ${bad.slice(0, 5).join(", ")}`);

  // ----- matchups: pairings + live lineup totals from day-by-day ESPN rosters -----
  const sched = (L.schedule || []).filter((m) => m.matchupPeriodId === curMP);
  const pairs = sched.map((m) => [idToKey[m.home?.teamId], idToKey[m.away?.teamId]]).filter((p) => p[0] && p[1]);
  const myPair = pairs.find((p) => p.includes(ME));
  if (!myPair) throw new Error(`No ${ME} matchup found in matchup period ${curMP}`);
  const opp = myPair[0] === ME ? myPair[1] : myPair[0];

  const current = {}, days = {};
  for (const t of TEAMS) { current[t] = {}; for (const k of RAW) current[t][k] = 0; }
  for (const sp of mpDays(curMP).filter((s) => s <= latestSP && s < curSP + 1)) {
    const D = await get(`view=mRoster&scoringPeriodId=${sp}`);
    const date = spDate(sp); days[date] = {};
    for (const t of D.teams || []) {
      const key = idToKey[t.id]; if (!key) continue; days[date][key] = [];
      for (const e of t.roster?.entries || []) {
        const pl = e.playerPoolEntry?.player || {};
        const s = (pl.stats || []).find((x) => x.statSourceId === 0 && x.scoringPeriodId === sp && x.statSplitTypeId === 5) ||
                  (pl.stats || []).find((x) => x.statSourceId === 0 && x.scoringPeriodId === sp);
        if (!s || !s.stats || !(+(s.stats[SID.min] || 0) > 0 || +(s.stats[SID.fga] || 0) > 0 || +(s.stats[SID.pts] || 0) > 0)) continue;
        const line = statLine(s.stats), on = !BENCH.has(e.lineupSlotId);
        const nk = ALIAS[norm(pl.fullName)] || norm(pl.fullName);
        days[date][key].push([prevBy.get(nk)?.n || pl.fullName, SLOT[e.lineupSlotId] || String(e.lineupSlotId), ...RAW.map((k) => line[k])]);
        if (on) for (const k of RAW) current[key][k] += line[k];
      }
    }
  }
  step(`daily lineups read: ${Object.keys(days).join(", ") || "none yet"}`);
  // ESPN may not have rolled "today" over yet: if today's date already has stats, count from tomorrow
  const todayD = spDate(curSP), playedToday = Object.values(days[todayD] || {}).some((a) => a.length);
  const fromD = playedToday ? addDays(todayD, 1) : todayD;
  const espnMPs = [...new Set((L.schedule || []).map((m) => m.matchupPeriodId))].length, regWeeks = REFW.filter((w) => w.w <= 18).length;
  status.checks.matchupPeriods = { espn: espnMPs, siteRegularSeason: regWeeks };
  if (espnMPs && espnMPs < regWeeks) status.warnings.push(`ESPN has ${espnMPs} matchup periods but the site has ${regWeeks} regular-season weeks — check week boundaries.`);
  // cross-check our lineup sums against ESPN's own matchup scoreboard
  const espnScore = {};
  for (const m of sched) for (const side of ["home", "away"]) {
    const key = idToKey[m[side]?.teamId], sb = m[side]?.cumulativeScore?.scoreByStat;
    if (key && sb) espnScore[key] = Object.fromEntries(CAT_IDS.map(([k, id]) => [k, sb[id]?.score ?? null]));
  }
  const mism = [];
  for (const t of TEAMS) {
    const e = espnScore[t]; if (!e || !Object.values(e).some((v) => v)) continue; const c = current[t];
    for (const k of ["tpm", "reb", "ast", "stl", "blk", "to", "pts"]) if (e[k] != null && Math.abs(e[k] - c[k]) > 0.01) mism.push(`${t} ${k}: ESPN ${e[k]} v summed ${c[k]}`);
    if (e.fgp != null && c.fga && Math.abs(e.fgp - c.fgm / c.fga) > 0.0006) mism.push(`${t} FG%: ESPN ${e.fgp} v summed ${(c.fgm / c.fga).toFixed(4)}`);
  }
  status.checks.liveTotals = current; status.checks.espnScoreboard = espnScore;
  if (mism.length) status.warnings.push(`Lineup sums disagree with ESPN's scoreboard: ${mism.join("; ")}`);

  // ----- season history from finished matchup periods -----
  const history = [], season = { w: 0, l: 0, t: 0, weeks: 0 };
  for (const m of (L.schedule || []).filter((x) => x.matchupPeriodId < curMP && x.winner && x.winner !== "UNDECIDED")) {
    const h = idToKey[m.home?.teamId], a = idToKey[m.away?.teamId]; if (h !== ME && a !== ME) continue;
    const mine = h === ME ? m.home : m.away, theirs = h === ME ? a : h, sb = mine.cumulativeScore?.scoreByStat || {};
    const cats = CAT_IDS.map(([, id]) => ({ WIN: "W", LOSS: "L", TIE: "T" })[sb[id]?.result] || "");
    const w = cats.filter((c) => c === "W").length, l = cats.filter((c) => c === "L").length, t = cats.filter((c) => c === "T").length;
    history.push({ week: m.matchupPeriodId, opp: theirs, w, l, t, cats });
    if (m.matchupPeriodId <= 18) { season.w += w; season.l += l; season.t += t; season.weeks++; }
  }
  history.sort((a, b) => a.week - b.week);

  // ----- write -----
  const out = { ...prev, espn, injuries: poolN >= 200 ? injuries : { ...(prev.injuries || {}), ...injuries }, injuriesAt: new Date().toISOString(), dead, dropped, season, history, me: ME, logPair: [ME, opp], logWeek: curMP, teams,
    days, updatedAt: new Date().toISOString(), source: { file: "ESPN Fantasy (auto-sync)", at: new Date().toISOString(), espn: true } };
  out.matchup = { ...(prev.matchup || {}), home: ME, away: opp, week: curMP, from: fromD, avail: 1, current };
  if (fromD > spDate(mpDays(curMP).slice(-1)[0] || curSP)) out.matchup.from = null;
  fs.writeFileSync(path.join(ROOT, "data", "league.json"), JSON.stringify(out));
  status.ok = true; status.checks.pairs = pairs; status.checks.from = out.matchup.from;
  step("league.json written");
}

main().catch((e) => { status.ok = false; status.error = String(e && e.message || e); })
  .finally(() => { fs.writeFileSync(statusPath, JSON.stringify(status, null, 1)); console.log(status.ok ? "ESPN sync OK" : "ESPN sync FAILED: " + status.error); if (!status.ok) process.exitCode = 0; });
