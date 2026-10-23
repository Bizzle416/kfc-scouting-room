// Runs the Scouting Room's own simulation code (from index.html) headlessly in Node,
// so Fryer Radio's numbers are exactly the numbers on the site. No copy of the maths lives here.
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

// Seeded RNG so the same data always gives the same (frozen) prediction.
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A do-anything stub standing in for the DOM: every property is itself, every call returns itself.
function stub() {
  const fn = function () {};
  const p = new Proxy(fn, {
    get: (_, k) => (k === Symbol.toPrimitive ? () => "" : k === "hidden" ? true : k === "length" ? 0 : k === "then" ? undefined : p),
    set: () => true,
    apply: () => p,
    construct: () => p,
  });
  return p;
}

export function loadEngine({ seed = 416 } = {}) {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const app = scripts.find((s) => s.includes("function simulate"));
  if (!app) throw new Error("Couldn't find the simulation script in index.html");

  const S = stub();
  const math = Object.create(Math);
  math.random = mulberry32(seed);
  const ctx = {
    console, Math: math, JSON, Date, Intl, Map, Set, Array, Object, String, Number, Boolean, Symbol,
    parseFloat, parseInt, isFinite, isNaN, Infinity, NaN, Promise, setTimeout: () => 0,
    document: S, window: S, localStorage: { getItem: () => null, setItem() {} },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    fetch: () => Promise.reject(new Error("headless")), XLSX: S, Blob: S, URL: S,
  };
  vm.createContext(ctx);
  // Drop the final bootstrap call so nothing tries to render.
  vm.runInContext(app.replace(/\nload\(\);\s*$/, "\n"), ctx, { filename: "index.html" });

  const league = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "league.json"), "utf8"));
  ctx.__league = league;
  vm.runInContext("state=migrate(Object.assign(state,__league));invalidate();", ctx);
  const run = (code) => vm.runInContext(code, ctx);
  return { run, ctx, league };
}

const pct = (x) => Math.round(x * 1000) / 10;
const r1 = (x) => Math.round(x * 10) / 10;

// Everything the hosts are allowed to say about one matchup. All numbers come from the site's code.
export function matchupReceipts(E, home, away, week, { useCurrent = true } = {}) {
  E.ctx.__args = { home, away, week, useCurrent };
  return E.run(`(()=>{
    const {home,away,week:wk,useCurrent}=__args;
    state.matchup.home=home;state.matchup.away=away;state.matchup.week=wk;state.matchup.from=(+wk===+state.logWeek&&useCurrent)?((__league.matchup||{}).from||null):null;
    const W=week(),from=fromDate(W);
    const cur=t=>useCurrent&&pairOK()?((state.matchup.current||{})[t]||{}):{};
    const pA=planRoster(state.teams[home]||[],W,from),pB=planRoster(state.teams[away]||[],W,from);
    const dA=distFrom(pA),dB=distFrom(pB),cA=cur(home),cB=cur(away);
    const r=simulate(dA,dB,cA,cB,SIMS);
    const fA=finalMeans(dA,cA),fB=finalMeans(dB,cB);
    const expW=expCats(r,SIMS),expT=CATS.reduce((s,c)=>s+r.cat[c.k].t/SIMS,0);
    const tally=sideTally(r);
    const cats=CATS.map(c=>{const w=r.cat[c.k].w/SIMS,t=r.cat[c.k].t/SIMS;return {k:c.k,l:c.l,win:w,tie:t,lose:1-w-t,
      side:catSide(r,c),home:fA[c.k],away:fB[c.k]}});
    const mode=r.dist.indexOf(Math.max(...r.dist));
    const starters=(plan,team)=>{const out=[];plan.games.forEach((g,tp)=>{const z=zOf(tp.n);
        const st=plan.days.filter(d=>d.on.some(x=>x[0]===tp.n)).length,gm=st+plan.days.filter(d=>d.off.includes(tp.n)).length;
        out.push({n:tp.n,games:gm,starts:st,z:Math.round(z*100)/100,impact:Math.round(g*z*10)/10,salary:tp.salary})});
      return out.sort((a,b)=>b.impact-a.impact)};
    const wasted=(plan)=>{const m={};plan.days.forEach(d=>d.off.forEach(n=>m[n]=(m[n]||0)+1));return Object.entries(m).sort((a,b)=>b[1]-a[1]).map(([n,g])=>({n,g}))};
    const outs=t=>(state.teams[t]||[]).filter(p=>p.status!=="active"||injOf(p.n)).map(p=>({n:p.n,status:p.status,salary:p.salary,injFlag:!!injOf(p.n),inj:injOf(p.n)}));
    const noData=t=>(state.teams[t]||[]).filter(p=>p.status==="active"&&!eff(p)).map(p=>p.n);
    const streamer=(team,key)=>{state.matchup.home=team;const b=bestFA(key,W,from);state.matchup.home=home;return b?{n:b.p.n,nba:b.p.t,per:Math.round(b.per*100)/100,games:Math.round(b.g)}:null};
    const swing=cats.filter(c=>c.win>.25&&c.win<.75);
    return {
      week:W.w,start:W.start,days:W.days,from,daily:pA.daily,
      home:{team:home,name:tname(home),winPct:r.w/SIMS,expCats:expW,drumsticks:tally.me,
        starts:dA.games,wasted:pA.benched,wastedBy:wasted(pA),all:starters(pA,home),payroll:payroll(state.teams[home]||[],home),
        dead:(state.dead||{})[home]||0,dropped:(state.dropped||{})[home]||[],outs:outs(home),noData:noData(home),
        streamers:swing.filter(c=>c.win<.5&&!c.k.endsWith("p")&&c.k!=="to").map(c=>({cat:c.l,fa:streamer(home,c.k)}))},
      away:{team:away,name:tname(away),winPct:r.l/SIMS,expCats:9-expW-expT,drumsticks:tally.opp,
        starts:dB.games,wasted:pB.benched,wastedBy:wasted(pB),all:starters(pB,away),payroll:payroll(state.teams[away]||[],away),
        dead:(state.dead||{})[away]||0,dropped:(state.dropped||{})[away]||[],outs:outs(away),noData:noData(away),
        streamers:swing.filter(c=>c.win>.5&&!c.k.endsWith("p")&&c.k!=="to").map(c=>({cat:c.l,fa:streamer(away,c.k)}))},
      tiePct:r.t/SIMS,expTies:expT,coinFlips:tally.flip,likelyScore:{home:mode,dist:r.dist.map(n=>n/SIMS)},
      cats,swing:swing.map(c=>c.l),
      locked:{home:cats.filter(c=>c.win>=.9).map(c=>c.l),away:cats.filter(c=>c.lose>=.9).map(c=>c.l)},
      usedLiveTotals:useCurrent&&pairOK()&&Object.values(state.matchup.current||{}).some(o=>Object.values(o||{}).some(v=>v>0)),
    };
  })()`);
}

// The week's pairings. The workbook logs the commissioner's game; the other two teams play each other.
export function pairings(E) {
  const L = E.league, teams = ["Bizzle", "Danna", "Mamba", "Slav"];
  const a = L.logPair && L.logPair.length === 2 ? L.logPair : [L.matchup.home, L.matchup.away];
  const rest = teams.filter((t) => !a.includes(t));
  return [a, rest];
}

export function weekInfo(E) {
  return E.run(`({week:+state.logWeek||+state.matchup.week||1,me:state.me||"Bizzle",season:state.season,history:state.history})`);
}

export { pct, r1 };
