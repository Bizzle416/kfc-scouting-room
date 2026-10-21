// Turns receipts (facts from the sims / Matchup Log) into a two-host script.
// KEV = the hype man. NIGEL = the dry analyst. Every number spoken comes from the receipts.

const CAT_SAY = { "FG%": "field goal percentage", "FT%": "free throw percentage", "3PM": "threes", REB: "rebounds", AST: "assists", STL: "steals", BLK: "blocks", TO: "turnovers", PTS: "points" };
const say = (l) => CAT_SAY[l] || l;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const P = (x) => `${Math.round(x * 100)} percent`;
const $ = (n) => `${n} dollar${n === 1 ? "" : "s"}`;
const first = (n) => String(n).split(" ")[0];
const last = (n) => { const p = String(n).split(" "); return p.length > 1 ? p.slice(1).join(" ") : p[0]; };
const list = (a) => a.length <= 1 ? (a[0] || "") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1];

// Deterministic "random" so the same week always produces the same episode.
function picker(seed) {
  let h = 2166136261;
  for (const c of seed) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (arr) => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return arr[(h >>> 0) % arr.length]; };
}

function gameSegment(R, pick, story, idx) {
  const L = [], K = (t) => L.push({ host: "KEV", text: t }), N = (t) => L.push({ host: "NIGEL", text: t });
  const H = R.home, A = R.away;
  // The league scores every category, so talk in projected category scores, not "who wins the matchup".
  const sc = (x, y) => { const W = Math.round(x), T = Math.min(9 - W, Math.round(R.expTies || 0)); return [W, 9 - W - T, T]; };
  const hs = sc(H.expCats), fav = H.expCats >= A.expCats ? H : A, dog = fav === H ? A : H;
  const fs = fav === H ? hs : [hs[1], hs[0], hs[2]], gap = Math.abs(H.expCats - A.expCats);
  const scoreTxt = `${fs[0]} ${fs[1]}${fs[2] ? `, ${fs[2]} tied` : ""}`;

  K(pick(idx === 0
    ? [`Game one! ${H.team}'s ${H.name} against ${A.team}'s ${A.name}!`, `First up, it's ${H.team} versus ${A.team}! ${H.name} against the ${A.name}!`]
    : [`And game two! ${H.team} against ${A.team}!`, `Over to the other side of the draw. ${H.team} versus ${A.team}!`]));

  if (gap >= 4) N(pick([`Projected score: ${fav.team} ${scoreTxt}. That's not a matchup, that's a hostage situation.`, `The sims have ${fav.team} winning it ${scoreTxt}. ${dog.team}, I'd start writing the apology.`]));
  else if (gap >= 2) N(pick([`The model has ${fav.team} winning it ${scoreTxt}. Clear edge, every one of those categories counts in the standings.`, `${fav.team} projects ${scoreTxt}. Not a lock in every category, but the bulk of them.`]));
  else if (gap >= 0.6) N(pick([`${fav.team} edges it on projection, ${scoreTxt}. A couple of categories either way changes the week.`, `Lean ${fav.team}, ${scoreTxt}. This one's got a pulse.`]));
  else N(pick([`Dead even. The sims split the categories almost down the middle. Every single one is worth fighting for.`, `Projected near enough to ${scoreTxt}. Whoever streams smarter takes the extra categories.`]));
  const locked = [...(R.locked?.home || []), ...(R.locked?.away || [])];
  if (R.swing?.length) K(`Up for grabs: ${R.swing.join(", ")}!`);
  if (locked.length) N(`Already decided, more or less: ${[...(R.locked.home || []).map((c) => `${c} to ${H.team}`), ...(R.locked.away || []).map((c) => `${c} to ${A.team}`)].join(", ")}.`);

  for (const T of [H, A]) if (T.dead > 0) K(`And ${T.team} has already got ${$(T.dead)} of dead money on the books before a ball's been bounced!`);

  // A lifeline for the underdog.
  const tip = (dog.streamers || []).find((s) => s.fa);
  if (tip) N(pick([`If ${dog.team} wants a lifeline: ${tip.fa.n} is sitting on waivers. ${tip.fa.games} games, about ${Math.round(tip.fa.per * 10) / 10} ${say(tip.cat)} a game.`,
    `Free advice for ${dog.team}. Pick up ${tip.fa.n}. ${tip.fa.games} games, ${Math.round(tip.fa.per * 10) / 10} ${say(tip.cat)} a night. You're welcome.`]));

  return L;
}

export function previewScript(games, { week, story }) {
  const pick = picker(`preview-${week}`), L = [];
  const K = (t) => L.push({ host: "KEV", text: t }), N = (t) => L.push({ host: "NIGEL", text: t });
  K(pick([`Welcome to Fryer Radio! Week ${week} of the KFC Fantasy Cup! I'm Kev!`, `It's Fryer Radio, it's week ${week}, and the oil is hot! I'm Kev!`]));
  N(pick([`And I'm Nigel. Ten thousand simulations, nine categories, zero sympathy.`, `I'm Nigel. We ran every matchup ten thousand times so you don't have to.`]));
  if (games.some((g) => g.usedLiveTotals)) N(`Quick note: this one includes the totals logged so far this week. It's a live read, not a fresh preview.`);
  games.forEach((g, i) => L.push(...gameSegment(g, pick, story, i)));

  // Picks: biggest projected category margin, and the closest game.
  const margin = (g) => Math.abs(g.home.expCats - g.away.expCats), top = (g) => (g.home.expCats >= g.away.expCats ? g.home : g.away);
  const byM = games.slice().sort((a, b) => margin(b) - margin(a));
  K(`Nigel. Lock of the week.`);
  N(`${top(byM[0]).team}. Projected to win the categories by about ${Math.round(margin(byM[0]))}. Write it in pen.`);
  K(`Closest one?`);
  const c = byM[byM.length - 1];
  N(margin(c) < 1 ? `${c.home.team} and ${c.away.team}. Basically level on categories. That's where the standings move.` : `${c.home.team} versus ${c.away.team}. About ${Math.round(margin(c))} categories in it. Plenty of room for a swing.`);
  K(pick([`That's the preview! Set your lineups, and check the Scouting Room!`, `Lineups lock with the first game of the day! Don't be the guy with a star on the bench! See you after the final whistle!`]));
  return L;
}

export function reviewScript({ week, me, opp, result, preview, season }, { story }) {
  const pick = picker(`review-${week}`), L = [];
  const K = (t) => L.push({ host: "KEV", text: t }), N = (t) => L.push({ host: "NIGEL", text: t });
  const won = result.w > result.l, tied = result.w === result.l;
  K(pick([`Fryer Radio, full time, week ${week}!`, `The final whistle has gone on week ${week}! It's Fryer Radio!`]));
  K(`${me} against ${opp}. Final score in categories: ${result.w}, ${result.l}${result.t ? `, with ${result.t} tied` : ""}!`);
  K(won ? pick([`${me} takes it!`, `That's a W for ${me}!`]) : tied ? `It's a draw! Nobody gets the drumstick!` : pick([`${opp} gets the job done!`, `${me} goes down!`]));
  if (Math.abs(result.w - result.l) === 1) N(pick([`One category. The whole week came down to one category.`, `Decided by a single category. Somebody's waiver wire is going to haunt them.`]));
  else if (Math.abs(result.w - result.l) >= 5) N(`That's not a result, that's a crime scene.`);

  if (preview) {
    const ex = preview.home.team === me ? preview.home.expCats : preview.away.expCats, off = result.w - ex;
    if (Math.abs(off) < 1) N(`The model projected ${me} for about ${Math.round(ex)} categories. Got ${result.w}. I'd like that noted.`);
    else if (off >= 1) N(`The model had ${me} down for about ${Math.round(ex)} categories. Took ${result.w}. Beat the sims.`);
    else N(`The model said about ${Math.round(ex)} categories for ${me}. Got ${result.w}. That aged like milk in the sun.`);

    const meIsHome = preview.home.team === me;
    const wrong = [], right = [];
    preview.cats.forEach((c, i) => {
      const myWin = meIsHome ? c.win : c.lose, call = myWin > 0.55 ? "W" : myWin < 0.45 ? "L" : null, got = result.cats[i];
      if (!call || got === "T") return;
      (call === got ? right : wrong).push({ l: c.l, p: call === "W" ? myWin : 1 - myWin, call });
    });
    wrong.sort((a, b) => b.p - a.p);
    if (wrong.length) {
      const w = wrong[0];
      K(`Where did the model get it wrong, Nigel?`);
      N(`${cap(say(w.l))}. It had ${w.call === "W" ? me : opp} at ${P(w.p)} there, and ${w.call === "W" ? opp : me} took it.${wrong.length > 1 ? ` It also missed ${list(wrong.slice(1, 3).map((x) => say(x.l)))}.` : ""}`);
    } else if (right.length) N(`Every category the model had a lean on went the way it said. ${right.length} from ${right.length}. Don't argue with the fryer.`);
  } else N(`No preview was saved for this week, so no receipts to check the model against.`);

  if (season) N(`That makes the season ${season.w}, ${season.l}${season.t ? `, ${season.t}` : ""} in categories for ${me}.`);
  const others = ["Bizzle", "Danna", "Mamba", "Slav"].filter((t) => t !== me && t !== opp);
  K(`And ${others[0]} against ${others[1]}?`);
  N(`Not in the Matchup Log, so no receipts. And no receipts means no roast. Log it, lads.`);
  K(`That's full time! Fryer Radio, out!`);
  return L;
}

// Optional: let a free LLM punch up the script, but only if it invents nothing.
export async function punchUp(lines, { apiKey, model = "gemini-2.5-flash", story }) {
  if (!apiKey) return null;
  const numbers = (s) => (s.match(/\d+(?:\.\d+)?/g) || []);
  const allowed = new Set(lines.flatMap((l) => numbers(l.text)));
  const prompt = `You are punching up a script for "Fryer Radio", a two-host comedy recap of a 4-person fantasy basketball league played for laughs among mates.
KEV is a loud, excitable hype man. NIGEL is a dry, cutting British analyst.
Rewrite the script below to be funnier and more natural as spoken audio. Rules:
- Keep every fact. Do NOT add any number, statistic, player, salary or result that is not already in the script.
- Every number you use must appear in the original script exactly as written.
- Banter about fantasy decisions only. Nothing about anyone's real life.
- Short spoken sentences. No emojis, no stage directions, no sound effects.
- Same rough length (within 20%).
Running jokes you may reference: ${JSON.stringify(story)}
Return ONLY JSON: an array of {"host":"KEV"|"NIGEL","text":"..."}.

SCRIPT:
${JSON.stringify(lines)}`;
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", temperature: 0.9 } }),
    });
    if (!r.ok) throw new Error(`Gemini HTTP ${r.status}`);
    const j = await r.json();
    const out = JSON.parse(j.candidates[0].content.parts[0].text);
    if (!Array.isArray(out) || !out.length || out.some((l) => !["KEV", "NIGEL"].includes(l.host) || typeof l.text !== "string")) throw new Error("bad shape");
    const invented = out.flatMap((l) => numbers(l.text)).filter((n) => !allowed.has(n));
    if (invented.length) throw new Error(`invented numbers: ${invented.join(", ")}`);
    const len = (a) => a.reduce((s, l) => s + l.text.length, 0);
    if (len(out) > len(lines) * 1.4) throw new Error("too long");
    return out;
  } catch (e) {
    console.warn(`Punch-up skipped, using the template script (${e.message})`);
    return null;
  }
}
