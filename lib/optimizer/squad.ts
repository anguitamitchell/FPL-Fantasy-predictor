import type { Pos } from "@/lib/model/types";

export interface OptPlayer {
  id: number;
  pos: Pos;
  team: number;
  price: number; // tenths of £m (FPL now_cost)
  xp: number[]; // expected points per GW over the horizon
}

export interface OptInput {
  pool: OptPlayer[]; // candidates; must include every owned player
  owned: { id: number; sell: number }[]; // current squad with selling prices (tenths)
  bank: number; // tenths
  freeTransfers: number;
  /** Exact number of transfers to make, or undefined to let the solver choose (up to maxTransfers). */
  exactTransfers?: number;
  maxTransfers?: number;
  hitCost?: number; // points per extra transfer (4); 0 for wildcard/free hit
  discount?: number; // weight multiplier per future GW (uncertainty)
  benchWeight?: number; // value of bench points (autosub insurance)
  locked?: number[]; // must keep / must buy
  banned?: number[]; // never pick
  squadSize?: Record<Pos, number>;
  teamLimit?: number;
}

export interface Lineup {
  gw: number; // index into the horizon
  starters: number[];
  bench: number[]; // ordered: GK first, then outfield by xp
  captain: number;
  vice: number;
  xp: number; // starters + captain bonus (undiscounted)
}

export interface OptResult {
  status: string;
  squad: number[];
  transfersIn: number[];
  transfersOut: number[];
  hits: number;
  objective: number;
  /** Undiscounted lineup points over the horizon (incl. captain), minus hit cost. */
  netPoints: number;
  lineups: Lineup[];
  bankAfter: number;
}

const DEFAULT_SIZE: Record<Pos, number> = { GKP: 2, DEF: 5, MID: 5, FWD: 3 };
const MIN_START: Record<Pos, number> = { GKP: 1, DEF: 3, MID: 2, FWD: 1 };
const MAX_START: Record<Pos, number> = { GKP: 1, DEF: 5, MID: 5, FWD: 3 };

type Highs = { solve: (lp: string, opts?: Record<string, unknown>) => HighsSolution };
type HighsSolution = { Status: string; ObjectiveValue: number; Columns: Record<string, { Primal: number }> };

let highsPromise: Promise<Highs> | null = null;
export function loadSolver(): Promise<Highs> {
  if (!highsPromise) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const loader = require("highs") as (opts?: unknown) => Promise<Highs>;
    highsPromise = loader();
  }
  return highsPromise;
}

const fmtCoef = (c: number) => (c >= 0 ? `+ ${c.toFixed(6)}` : `- ${(-c).toFixed(6)}`);

/** Builds the MILP in CPLEX LP format. */
export function buildLp(input: OptInput): string {
  const H = input.pool[0]?.xp.length ?? 0;
  const disc = input.discount ?? 0.85;
  const benchW = input.benchWeight ?? 0.1;
  const hitCost = input.hitCost ?? 4;
  const size = input.squadSize ?? DEFAULT_SIZE;
  const teamLimit = input.teamLimit ?? 3;
  const ownedSell = new Map(input.owned.map((o) => [o.id, o.sell]));
  const banned = new Set(input.banned ?? []);
  const pool = input.pool.filter((p) => !banned.has(p.id) || ownedSell.has(p.id));

  const obj: string[] = [];
  const rows: string[] = [];
  const binaries: string[] = [];
  const x = (id: number) => `x${id}`;
  const s = (t: number, id: number) => `s${t}_${id}`;
  const c = (t: number, id: number) => `c${t}_${id}`;

  for (const p of pool) {
    binaries.push(x(p.id));
    let benchCoef = 0;
    for (let t = 0; t < H; t++) {
      const w = Math.pow(disc, t);
      binaries.push(s(t, p.id), c(t, p.id));
      // starter gets xp, captain gets xp again; bench value = benchW * xp on x minus starters
      obj.push(`${fmtCoef(w * p.xp[t] * (1 - benchW))} ${s(t, p.id)}`, `${fmtCoef(w * p.xp[t])} ${c(t, p.id)}`);
      benchCoef += w * p.xp[t] * benchW;
      rows.push(` st${t}_${p.id}: ${s(t, p.id)} - ${x(p.id)} <= 0`);
      rows.push(` cp${t}_${p.id}: ${c(t, p.id)} - ${s(t, p.id)} <= 0`);
    }
    if (benchCoef !== 0) obj.push(`${fmtCoef(benchCoef)} ${x(p.id)}`);
  }
  // Tiny cost even when hits are free (wildcard) so h isn't left at an arbitrary value.
  obj.push(`- ${Math.max(hitCost, 0.001).toFixed(6)} h`);

  // Squad composition
  rows.push(` size: ${pool.map((p) => `+ ${x(p.id)}`).join(" ")} = 15`);
  for (const pos of Object.keys(size) as Pos[]) {
    const ids = pool.filter((p) => p.pos === pos);
    rows.push(` pos_${pos}: ${ids.map((p) => `+ ${x(p.id)}`).join(" ")} = ${size[pos]}`);
  }
  const teams = new Set(pool.map((p) => p.team));
  for (const team of teams) {
    const ids = pool.filter((p) => p.team === team);
    if (ids.length > teamLimit) rows.push(` club_${team}: ${ids.map((p) => `+ ${x(p.id)}`).join(" ")} <= ${teamLimit}`);
  }

  // Budget: buying costs the current price; keeping an owned player "costs" its selling price.
  const funds = input.bank + input.owned.reduce((acc, o) => acc + o.sell, 0);
  rows.push(` budget: ${pool.map((p) => `+ ${ownedSell.get(p.id) ?? p.price} ${x(p.id)}`).join(" ")} <= ${funds}`);

  // Transfers: number of new players
  const newPlayers = pool.filter((p) => !ownedSell.has(p.id));
  const tExpr = newPlayers.length ? newPlayers.map((p) => `+ ${x(p.id)}`).join(" ") : "0 h";
  rows.push(` hits: ${tExpr} - h <= ${input.freeTransfers}`);
  if (input.exactTransfers !== undefined) rows.push(` exact: ${tExpr} = ${input.exactTransfers}`);
  else if (input.maxTransfers !== undefined) rows.push(` maxt: ${tExpr} <= ${input.maxTransfers}`);

  for (const id of input.locked ?? []) if (pool.some((p) => p.id === id)) rows.push(` lock_${id}: ${x(id)} = 1`);

  // Lineups
  for (let t = 0; t < H; t++) {
    rows.push(` xi${t}: ${pool.map((p) => `+ ${s(t, p.id)}`).join(" ")} = 11`);
    rows.push(` cap${t}: ${pool.map((p) => `+ ${c(t, p.id)}`).join(" ")} = 1`);
    for (const pos of Object.keys(MIN_START) as Pos[]) {
      const ids = pool.filter((p) => p.pos === pos).map((p) => `+ ${s(t, p.id)}`).join(" ");
      rows.push(` min${t}_${pos}: ${ids} >= ${MIN_START[pos]}`);
      rows.push(` max${t}_${pos}: ${ids} <= ${MAX_START[pos]}`);
    }
  }

  return [
    "Maximize",
    ` obj: ${obj.join(" ")}`,
    "Subject To",
    ...rows,
    "Bounds",
    " 0 <= h <= 15",
    "Generals",
    " h",
    "Binary",
    ...chunk(binaries, 50).map((b) => " " + b.join(" ")),
    "End",
  ].join("\n");
}

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

export async function optimise(input: OptInput): Promise<OptResult> {
  const highs = await loadSolver();
  const lp = buildLp(input);
  const sol = highs.solve(lp, { output_flag: false, mip_rel_gap: 1e-4, time_limit: 20 });
  if (sol.Status !== "Optimal" && sol.Status !== "Time limit reached") {
    return { status: sol.Status, squad: [], transfersIn: [], transfersOut: [], hits: 0, objective: 0, netPoints: 0, lineups: [], bankAfter: input.bank };
  }
  const on = (name: string) => (sol.Columns[name]?.Primal ?? 0) > 0.5;
  const byId = new Map(input.pool.map((p) => [p.id, p]));
  const ownedIds = new Set(input.owned.map((o) => o.id));
  const squad = input.pool.filter((p) => on(`x${p.id}`)).map((p) => p.id);
  const H = input.pool[0]?.xp.length ?? 0;
  const hits = Math.round(sol.Columns.h?.Primal ?? 0);
  const lineups: Lineup[] = [];
  for (let t = 0; t < H; t++) {
    const starters = squad.filter((id) => on(`s${t}_${id}`));
    const captain = squad.find((id) => on(`c${t}_${id}`)) ?? starters[0];
    const vice = [...starters].filter((id) => id !== captain).sort((a, b) => byId.get(b)!.xp[t] - byId.get(a)!.xp[t])[0];
    const benchIds = squad.filter((id) => !starters.includes(id));
    const bench = [
      ...benchIds.filter((id) => byId.get(id)!.pos === "GKP"),
      ...benchIds.filter((id) => byId.get(id)!.pos !== "GKP").sort((a, b) => byId.get(b)!.xp[t] - byId.get(a)!.xp[t]),
    ];
    const xp = starters.reduce((acc, id) => acc + byId.get(id)!.xp[t], 0) + byId.get(captain)!.xp[t];
    lineups.push({ gw: t, starters, bench, captain, vice, xp });
  }
  const ownedSell = new Map(input.owned.map((o) => [o.id, o.sell]));
  const spent = squad.reduce((acc, id) => acc + (ownedSell.get(id) ?? byId.get(id)!.price), 0);
  const funds = input.bank + input.owned.reduce((acc, o) => acc + o.sell, 0);
  return {
    status: sol.Status,
    squad,
    transfersIn: squad.filter((id) => !ownedIds.has(id)),
    transfersOut: input.owned.map((o) => o.id).filter((id) => !squad.includes(id)),
    hits,
    objective: sol.ObjectiveValue,
    netPoints: lineups.reduce((acc, l) => acc + l.xp, 0) - hits * (input.hitCost ?? 4),
    lineups,
    bankAfter: funds - spent,
  };
}

/** Keeps the top-N players per position by discounted horizon xp, plus anything required. */
export function prunePool(players: OptPlayer[], keep: Set<number>, perPos = 40, discount = 0.85): OptPlayer[] {
  const score = (p: OptPlayer) => p.xp.reduce((acc, v, t) => acc + v * Math.pow(discount, t), 0);
  const out = new Map<number, OptPlayer>();
  for (const pos of ["GKP", "DEF", "MID", "FWD"] as Pos[]) {
    const list = players.filter((p) => p.pos === pos).sort((a, b) => score(b) - score(a));
    // Keep cheap enablers too: best few per price bracket.
    for (const p of list.slice(0, perPos)) out.set(p.id, p);
    const cheapest = [...list].sort((a, b) => a.price - b.price || score(b) - score(a)).slice(0, 4);
    for (const p of cheapest) out.set(p.id, p);
  }
  for (const p of players) if (keep.has(p.id)) out.set(p.id, p);
  return [...out.values()];
}
