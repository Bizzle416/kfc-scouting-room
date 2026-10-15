// Fryer Radio: builds any missing episodes from data/league.json.
//   node radio/build.mjs              -> new preview for this week + reviews for finished weeks
//   node radio/build.mjs --force      -> rebuild this week's preview even if it exists
//   node radio/build.mjs --no-audio   -> scripts only (skip the voice step)
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { loadEngine, matchupReceipts, pairings, weekInfo } from "./engine.mjs";
import { previewScript, reviewScript, punchUp } from "./writer.mjs";

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
manifest.episodes.sort((a, b) => b.week - a.week || (a.type === "review" ? -1 : 1));
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
console.log(made.length ? `Built: ${made.map((e) => `${e.id} (${e.writer})`).join(", ")}` : "Nothing new to build.");
