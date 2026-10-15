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
  const fav = H.winPct >= A.winPct ? H : A, dog = fav === H ? A : H;
  const p = fav.winPct, gap = Math.abs(H.winPct - A.winPct);

  K(pick(idx === 0
    ? [`Game one! ${H.team}'s ${H.name} against ${A.team}'s ${A.name}!`, `First up, it's ${H.team} versus ${A.team}! ${H.name} against the ${A.name}!`]
    : [`And game two! ${H.team} against ${A.team}!`, `Over to the other side of the draw. ${H.team} versus ${A.team}!`]));

  if (p >= 0.85) {
    N(pick([`${fav.team} wins this ${P(p)} of the time. That's not a matchup, that's a hostage situation.`,
      `Ten thousand sims. ${fav.team} takes ${P(p)} of them. ${dog.team}, I'd start writing the apology to your fans.`]));
  } else if (p >= 0.65) {
    N(pick([`${fav.team} is a clear favourite. ${P(p)} to take more categories.`, `The model likes ${fav.team} here. ${P(p)}. Not a lock, but close enough to smell the gravy.`]));
  } else if (gap >= 0.1) {
    N(pick([`${fav.team} gets the nod, but only just. ${P(p)}. This one's got a pulse.`, `Lean ${fav.team}. ${P(p)}. Anyone telling you it's over is lying.`]));
  } else {
    N(pick([`Honestly? Coin flip. ${H.team} ${P(H.winPct)}, ${A.team} ${P(A.winPct)}. Pack a lunch.`, `This is a genuine toss-up. ${P(H.winPct)} to ${P(A.winPct)}. Whoever streams smarter wins it.`]));
  }

  // The drumstick paradox: favoured overall while trailing in more categories.
  if (fav.drumsticks < dog.drumsticks) {
    K(`Hang on though. ${dog.team} is ahead in more categories! ${dog.drumsticks} to ${fav.drumsticks}!`);
    N(`Correct, and it doesn't matter. ${dog.team}'s leads are paper thin. ${fav.team}'s leads are real. Quality over quantity, Kev.`);
  }

  // Biggest edge and closest category.
  const edge = R.cats.slice().sort((a, b) => Math.abs(b.win - b.lose) - Math.abs(a.win - a.lose))[0];
  const owner = edge.win > edge.lose ? H : A, ownP = Math.max(edge.win, edge.lose);
  K(pick([`${owner.team} owns ${say(edge.l)} this week. ${P(ownP)}. Lock it in!`, `The biggest edge on the board? ${owner.team} in ${say(edge.l)}. ${P(ownP)}!`]));
  const flip = R.cats.slice().sort((a, b) => Math.abs(a.win - a.lose) - Math.abs(b.win - b.lose))[0];
  N(pick([`The knife-edge is ${say(flip.l)}. ${P(flip.win)} ${H.team}, ${P(flip.lose)} ${A.team}. That's where your waiver move goes.`,
    `Watch ${say(flip.l)}. ${P(flip.win)} to ${P(flip.lose)}. One hot night decides it.`]));

  // Star of the matchup.
  const all = [...H.all.map((x) => ({ ...x, t: H })), ...A.all.map((x) => ({ ...x, t: A }))].filter((x) => x.games > 0);
  const star = all.slice().sort((a, b) => b.impact - a.impact)[0];
  if (star) K(pick([`Star of the matchup: ${star.n}! ${star.games} games, and the biggest projected impact on the floor!`,
    `Keep your eyes on ${star.n}. ${star.games} games this week and the model rates him the most dangerous man in this matchup!`]));

  // Bargain and overpay.
  const bargain = all.filter((x) => x.salary <= 10 && x.impact >= 8).sort((a, b) => b.impact - a.impact)[0];
  if (bargain) N(pick([`Best value on the floor: ${bargain.n}. ${$(bargain.salary)}. Projected to outproduce guys on ten times the salary.`,
    `${bargain.t.team} is getting ${bargain.n} for ${$(bargain.salary)}. That's daylight robbery, and I respect it.`]));
  const pricey = all.filter((x) => x.salary >= 60 && x.games <= 2).sort((a, b) => b.salary - a.salary)[0];
  if (pricey) K(pick([`Meanwhile ${pricey.t.team} pays ${$(pricey.salary)} for ${pricey.n}, and he plays ${pricey.games} games this week!`,
    `${$(pricey.salary)} on ${pricey.n} and you get ${pricey.games} games! The schedule makers have no respect!`]));

  // Wasted bucket: games stuck on the bench.
  const waste = [H, A].sort((a, b) => b.wasted - a.wasted)[0];
  if (waste.wasted >= 5 && waste.wastedBy.length) {
    const w = waste.wastedBy[0];
    N(`${waste.team} has ${Math.round(waste.wasted)} games with nowhere to put them. ${w.n} alone has ${w.g} games stuck on the bench. That's the wasted bucket, and it's overflowing.`);
    const bit = (story[waste.team] || {}).waste;
    if (bit) K(bit);
  }

  // Fan-favourite callbacks: a manager's guy is playing for the other side this week.
  for (const [me, them] of [[H, A], [A, H]]) {
    const fav = ((story[me.team] || {}).fanOf || []).map((n) => them.all.find((x) => x.n === n && x.games > 0)).find(Boolean);
    if (fav) {
      N(pick([`${me.team}, I'm told you're a big ${last(fav.n)} fan. Good news, you'll see plenty of him this week. ${fav.games} games. For ${them.team}.`,
        `Spare a thought for ${me.team}, who loves ${fav.n}. ${them.team} owns him, and he's got ${fav.games} games this week.`]));
      break;
    }
  }

  // Injuries carried on the roster.
  for (const T of [H, A]) {
    const out = T.outs.filter((o) => o.status !== "active");
    if (out.length) N(`${T.team} has ${list(out.map((o) => o.n))} on the sidelines. ${$(out.reduce((s, o) => s + o.salary, 0))} of cap sitting in the stands.`);
  }

  // Dead cap already on the books.
  for (const T of [H, A]) if (T.dead > 0) K(`And ${T.team} has already got ${$(T.dead)} of dead money on the books before a ball's been bounced!`);

  // A lifeline for the underdog.
  const tip = (dog.streamers || []).find((s) => s.fa);
  if (tip && dog.winPct < 0.5) N(pick([`If ${dog.team} wants a lifeline: ${tip.fa.n} is sitting on waivers. ${tip.fa.games} games, about ${Math.round(tip.fa.per * 10) / 10} ${say(tip.cat)} a game.`,
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

  // Picks.
  const favs = games.map((g) => (g.home.winPct >= g.away.winPct ? g.home : g.away)).sort((a, b) => b.winPct - a.winPct);
  const dogs = games.map((g) => (g.home.winPct >= g.away.winPct ? g.away : g.home)).sort((a, b) => b.winPct - a.winPct);
  K(`Nigel. Lock of the week.`);
  N(`${favs[0].team}. ${P(favs[0].winPct)}. Write it in pen.`);
  K(`Upset alert?`);
  N(dogs[0].winPct >= 0.3 ? `${dogs[0].team} at ${P(dogs[0].winPct)}. That's not nothing.` : `${dogs[0].team} at ${P(dogs[0].winPct)}. I've seen better odds on a meat raffle.`);
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
    const p = preview.home.team === me ? preview.home.winPct : preview.away.winPct;
    if (won && p >= 0.6) N(`The model had ${me} at ${P(p)}. It said this would happen, and it happened. I'd like that noted.`);
    else if (!won && !tied && p >= 0.6) N(`The model had ${me} at ${P(p)}. So. That aged like milk in the sun.`);
    else if (won && p < 0.4) N(`The model gave ${me} just ${P(p)}. Upset! The sims are filing a complaint.`);
    else N(`The model had ${me} at ${P(p)} going in. Close enough to call it fair.`);

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
