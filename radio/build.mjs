// Fryer Radio: builds any missing episodes from data/league.json.
//   node radio/build.mjs              -> new preview for this week + reviews for finished weeks
//   node radio/build.mjs --force      -> rebuild this week's preview even if it exists
//   node radio/build.mjs --no-audio   -> scripts only (skip the voice step)
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { loadEngine, matchupReceipts, pairings, weekInfo } from "./engine.mjs";
import { previewScript, reviewScript, midweekScript, speakCats, punchUp } from "./writer.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const EP = path.join(ROOT, "radio", "episodes");
const args = new Set(process.argv.slice(2));
fs.mkdirSync(EP, { recursive: true });

const story = JSON.parse(fs.readFileSync(path.join(ROOT, "radio", "storylines.json"), "utf8")).managers;
const manifestPath = path.join(EP, "index.json");
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : { episodes: [] };
const pad = (n) => String(n).padStart(2, "0");
const has = (id) => fs.existsSync(path.join(EP, `${id}.json`));
const readEp = (id) => (has(id) ? JSON.parse(fs.readFileSync(path.join(EP, `${id}.json`), "utf8")) : null);
const made = [];

async function finish(ep) {
  ep.lines = speakCats(ep.lines);
  const llm = await punchUp(ep.lines, { apiKey: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL || undefined, story });
  if (llm) { ep.templateLines = ep.lines; ep.lines = llm; ep.writer = "gemini"; } else ep.writer = "templates";
  fs.writeFileSync(path.join(EP, `${ep.id}.json`), JSON.stringify(ep, null, 1));
  made.push(ep);
}

const E = loadEngine();
const info = weekInfo(E);
const league = E.league;

// 1) Reviews for finished weeks in the Matchup Log that don't have one yet.
for (const h of (info.history || []).filter((x) => x.week <= 18).sort((a, b) => a.week - b.week)) {
  const id = `wk${pad(h.week)}-review`;
  if (has(id)) continue;
  const prev = readEp(`wk${pad(h.week)}-preview`);
  const preview = prev ? prev.receipts.find((g) => [g.home.team, g.away.team].includes(info.me)) : null;
  const upTo = info.history.filter((x) => x.week <= h.week && x.week <= 18);
  const season = upTo.reduce((s, x) => ({ w: s.w + x.w, l: s.l + x.l, t: s.t + x.t }), { w: 0, l: 0, t: 0 });
  const facts = { week: h.week, me: info.me, opp: h.opp, result: { w: h.w, l: h.l, t: h.t, cats: h.cats }, preview, season };
  await finish({ id, type: "review", week: h.week, title: `Week ${h.week} full time`, createdAt: new Date().toISOString(),
    dataUpdatedAt: league.updatedAt, receipts: facts, lines: reviewScript(facts, { story }) });
}

// 2) Preview for the current week, frozen once made (the review grades it later).
const wk = info.week, pid = `wk${pad(wk)}-preview`;
if (wk <= 18 && (!has(pid) || args.has("--force"))) {
  const games = pairings(E).map(([h, a]) => matchupReceipts(E, h, a, wk));
  await finish({ id: pid, type: "preview", week: wk, title: `Week ${wk} preview`, createdAt: new Date().toISOString(),
    dataUpdatedAt: league.updatedAt, receipts: games, lines: previewScript(games, { week: wk, story }) });
}

// 2b) Midweek update (on request: node radio/build.mjs --update)
if (args.has("--update") && wk <= 18) {
  const days = Object.keys(league.days || {}).sort(), asOf = days[days.length - 1];
  const dayLabel = (iso) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-AU", { weekday: "long", timeZone: "UTC" }) + " night";
  const K = ["fgm", "fga", "ftm", "fta", "tpm", "reb", "ast", "stl", "blk", "to", "pts"], SAY = { ast: "assists", reb: "rebounds", tpm: "threes", stl: "steals", blk: "blocks", pts: "points" };
  const prevEp = readEp(`wk${pad(wk)}-preview`);
  const sal = {}; for (const [t, ps] of Object.entries(league.teams)) for (const p of ps) sal[p.n] = { t, s: p.salary };
  const games = pairings(E).map(([a, b]) => {
    const R = matchupReceipts(E, a, b, wk), cur = league.matchup.current;
    const now = E.run(`(()=>{const c=state.matchup.current,s=catScore(RAW.map(k=>c[${JSON.stringify(a)}][k]),RAW.map(k=>c[${JSON.stringify(b)}][k]));return s})()`);
    const lines = [], teamNight = {};
    for (const d of days) for (const t of [a, b]) for (const r of (league.days[d][t] || [])) {
      const on = r[1] !== "BE" && r[1] !== "IR", o = Object.fromEntries(K.map((k, i) => [k, r[2 + i]]));
      if (on) { lines.push({ d, t, n: r[0], ...o }); teamNight[t + d] = teamNight[t + d] || { t, d, ...Object.fromEntries(K.map((k) => [k, 0])) }; K.forEach((k) => teamNight[t + d][k] += o[k]); }
    }
    // the rabbit: re-run the sims as they stood before each night; the biggest one-night swing in a counting category
    const simAt = (n) => { // n = nights banked
      const cum = { [a]: Object.fromEntries(K.map((k) => [k, 0])), [b]: Object.fromEntries(K.map((k) => [k, 0])) };
      for (const d of days.slice(0, n)) for (const t of [a, b]) { const x = teamNight[t + d]; if (x) K.forEach((k) => cum[t][k] += x[k]); }
      E.ctx.__sim = { a, b, cum, from: n < days.length ? days[n] : league.matchup.from, wk };
      return E.run(`(()=>{const {a,b,cum,from,wk}=__sim;state.matchup.week=wk;const W=week();const dA=distFrom(planRoster(state.teams[a],W,from)),dB=distFrom(planRoster(state.teams[b],W,from));
        const r=simulate(dA,dB,cum[a],cum[b],6000);return Object.fromEntries(CATS.map(c=>[c.k,r.cat[c.k].w/6000]))})()`);
    };
    const probs = [0, 1, 2, 3, 4, 5, 6].filter((n) => n <= days.length).map(simAt);
    let rabbit = null;
    for (let n = 1; n < probs.length; n++) for (const c of R.cats.filter((c) => SAY[c.k])) {
      const before = probs[n - 1][c.k], after = probs[n][c.k], drop = before - after, thief = drop > 0 ? b : a, victim = drop > 0 ? a : b;
      const x = teamNight[thief + days[n - 1]], y = teamNight[victim + days[n - 1]];
      if (!x || Math.abs(drop) < 0.2) continue;
      if (!rabbit || Math.abs(drop) > rabbit.mag)
        rabbit = { mag: Math.abs(drop), team: thief, victim, cat: c.l, say: SAY[c.k], value: x[c.k], theirs: y ? y[c.k] : 0, night: n,
          before: Math.round((drop > 0 ? before : 1 - before) * 100), after: Math.round((drop > 0 ? after : 1 - after) * 100) };
    }
    const byPlayer = {}; for (const x of lines) (byPlayer[x.n] = byPlayer[x.n] || { n: x.n, t: x.t, g: [] }).g.push(x.pts);
    const cheapHeroes = Object.values(byPlayer).map((p) => ({ ...p, salary: (sal[p.n] || {}).s ?? 5, best: Math.max(...p.g) }))
      .filter((p) => p.salary <= 5 && (p.best >= 30 || p.g.reduce((s, x) => s + x, 0) / p.g.length >= 22))
      .sort((x, y) => y.best - x.best).map((p) => { const srt = p.g.slice().sort((x, y) => y - x);
        return { n: p.n, team: p.t, salary: p.salary, fa: p.salary === 5, best: srt[0], second: srt[1] ?? srt[0], games: p.g.length, avg: Math.round(p.g.reduce((s, x) => s + x, 0) / p.g.length) }; });
    let benchWaste = null;
    for (const d of days) for (const t of [a, b]) { const be = (league.days[d][t] || []).filter((r) => r[1] === "BE"), pts = be.reduce((s, r) => s + r[r.length - 1], 0);
      if (!benchWaste || pts > benchWaste.pts) benchWaste = { team: t, victimOf: t === a ? b : a, pts, dayLabel: `night ${days.indexOf(d) + 1}`, who: be.sort((x, y) => y[y.length - 1] - x[x.length - 1])[0]?.[0] }; }
    const expA = R.home.expCats, expB = R.away.expCats, lead = expA >= expB ? a : b, ps = [Math.round(Math.max(expA, expB)), 9 - Math.round(Math.max(expA, expB)) - Math.round(R.expTies)];
    const swing = R.cats.filter((c) => c.win > 0.3 && c.win < 0.7).map((c) => c.l);
    const behind = expA < expB ? a : b, needN = Math.max(0, 5 - Math.round(Math.min(expA, expB)));
    const need = swing.length ? `For ${behind} to steal it, they need ${needN} more categor${needN === 1 ? "y" : "ies"} to flip. ${swing.length === 1 ? `The only live one is ${swing[0]}` : `The live ones are ${swing.slice(0, -1).join(", ")} and ${swing[swing.length - 1]}`}.` : "";
    return { teams: [a, b], now, projLeader: lead, projScore: ps, swing, rabbit, cheapHeroes, benchWaste, need,
      topLines: lines.sort((x, y) => y.pts - x.pts).filter((x, i, arr) => arr.findIndex((z) => z.n === x.n) === i).slice(0, 3), side: { [a]: { team: a, wasted: R.home.wasted }, [b]: { team: b, wasted: R.away.wasted } } };
  });
  // per-team luck: banked starter points v projection, shooting, injuries, transactions
  E.ctx.__days = league.days;
  const teams = JSON.parse(E.run(`(()=>{const out={};for(const t of TEAMS){let ap=0,pp=0,fgm=0,fga=0;const pl={};
    for(const d of Object.keys(__days))for(const r of (__days[d][t]||[])){if(r[1]==="BE"||r[1]==="IR")continue;const o=Object.fromEntries(RAW.map((k,i)=>[k,r[2+i]]));const pj=(ref(r[0])||{}).pj;
      ap+=o.pts;fgm+=o.fgm;fga+=o.fga;if(pj)pp+=pj.pts;const P=pl[r[0]]=pl[r[0]]||{n:r[0],g:0,fgm:0,fga:0,over:0};P.g++;P.fgm+=o.fgm;P.fga+=o.fga;P.over+=o.pts-(pj?pj.pts:o.pts)}
    const ps=Object.values(pl),sharp=ps.filter(p=>p.fga>=5&&p.fgm/p.fga>.5);
    out[t]={team:t,over:Math.round(ap-pp),overPct:+((ap/Math.max(1,pp)-1)*100).toFixed(0),fg:+(fgm/Math.max(1,fga)*100).toFixed(1),sharp:sharp.map(p=>p.n),
      best:sharp.filter(p=>p.fga>=15).sort((a,b)=>b.fgm/b.fga-a.fgm/a.fga)[0]||null,hero:ps.sort((a,b)=>b.over-a.over)[0]?{n:ps[0].n,over:Math.round(ps[0].over),g:ps[0].g}:null,
      inj:(state.teams[t]||[]).filter(p=>injOf(p.n)).map(p=>({n:p.n,s:injOf(p.n)}))}}return JSON.stringify(out)})()`));
  for (const g of games) { const [a, b] = g.teams; for (const [me, op] of [[a, b], [b, a]]) {
    const w = me === a ? g.now.w : g.now.l, l = me === a ? g.now.l : g.now.w; teams[me].leading = w > l; teams[me].score = `${w} ${l}`; teams[me].opp = op; } }
  // tilt: cold team with a panic move this week and/or a big night left on the bench
  const statusLog = []; try { for (const c of execFileSync("git", ["log", "--format=%h", "-40", "--", "data/espn-status.json"], { cwd: ROOT }).toString().trim().split("\n"))
    statusLog.push(JSON.parse(execFileSync("git", ["show", `${c}:data/espn-status.json`], { cwd: ROOT }).toString())); } catch {}
  for (const t of Object.values(teams)) {
    const adds = [...new Set(statusLog.flatMap((s) => (s.checks?.rosterChanges?.added || []).filter((x) => x.startsWith(t.team + ":")).map((x) => x.split(": ")[1].replace(/ \(.*/, ""))))];
    const drops = [...new Set(statusLog.flatMap((s) => (s.checks?.rosterChanges?.dropped || []).filter((x) => x.startsWith(t.team + ":")).map((x) => x.split(": ")[1].replace(/ \(.*/, ""))))];
    const bw = games.map((g) => g.benchWaste).find((x) => x && x.team === t.team && x.pts >= 60);
    const bits = []; if (adds.length) bits.push(`Panic-added ${adds.join(" and ")}${drops.length ? `, cut ${drops.join(" and ")}` : ""}.`); if (bw) bits.push(`Left ${bw.pts} points on the bench on ${bw.dayLabel}.`);
    t.tilt = bits.join(" ");
  }
  const id = `wk${pad(wk)}-update-${asOf.slice(5).replace("-", "")}`;
  await finish({ id, type: "update", week: wk, title: `Week ${wk} midweek (${days.length} nights)`, createdAt: new Date().toISOString(),
    dataUpdatedAt: league.updatedAt, receipts: { asOf, games, teams }, lines: midweekScript({ week: wk, asOf, nights: days.length, games, teams }, { story }) });
}

// 3) Voices.
if (!args.has("--no-audio")) {
  for (const ep of made) execFileSync("python3", [path.join(ROOT, "radio", "tts.py"), path.join(EP, `${ep.id}.json`)], { stdio: "inherit" });
}

// 4) Manifest the site reads.
for (const ep of made) {
  const saved = readEp(ep.id);
  manifest.episodes = manifest.episodes.filter((e) => e.id !== ep.id);
  manifest.episodes.push({ id: ep.id, type: ep.type, week: ep.week, title: ep.title, createdAt: ep.createdAt,
    seconds: saved.seconds || null, audio: fs.existsSync(path.join(EP, `${ep.id}.mp3`)) ? `radio/episodes/${ep.id}.mp3` : null,
    script: `radio/episodes/${ep.id}.json`, writer: ep.writer });
}
const RANK = { review: 0, update: 1, preview: 2 };
manifest.episodes.sort((a, b) => b.week - a.week || (RANK[a.type] ?? 3) - (RANK[b.type] ?? 3) || String(b.createdAt).localeCompare(String(a.createdAt)));
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
console.log(made.length ? `Built: ${made.map((e) => `${e.id} (${e.writer})`).join(", ")}` : "Nothing new to build.");
