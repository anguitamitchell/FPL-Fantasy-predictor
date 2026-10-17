import type { PlayerRow } from "@/lib/data/view";
import { optimise, prunePool, type OptPlayer, type OptResult } from "./squad";

export interface ScenarioRequest {
  squad: { id: number; sell: number }[];
  bank: number; // tenths
  freeTransfers: number;
  locked?: number[];
  banned?: number[];
  chips?: string[]; // chips available, e.g. ["wildcard", "freehit"]
  maxHits?: number;
}

export interface Scenario {
  key: string;
  title: string;
  description: string;
  result: OptResult;
  gainVsHold: number; // net points over horizon vs making no transfers
  nextGwGain: number;
  recommended?: boolean;
}

/** Value of rolling an unused free transfer (flexibility later), in points. */
export const ROLL_VALUE = 1.5;
/** Extra margin demanded per hit on top of its 4 points, because projections are noisy. */
export const HIT_MARGIN = 2;

export async function planScenarios(players: PlayerRow[], req: ScenarioRequest): Promise<{ scenarios: Scenario[]; advice: string }> {
  const all: OptPlayer[] = players.map((p) => ({ id: p.id, pos: p.pos, team: p.team, price: Math.round(p.price * 10), xp: p.byGw }));
  const known = new Set(all.map((p) => p.id));
  const missing = req.squad.filter((s) => !known.has(s.id));
  if (missing.length) throw new Error(`Unknown player ids: ${missing.map((m) => m.id).join(", ")}`);
  const keep = new Set([...req.squad.map((s) => s.id), ...(req.locked ?? [])]);
  const pool = prunePool(all, keep);
  const base = { pool, owned: req.squad, bank: req.bank, freeTransfers: req.freeTransfers, locked: req.locked, banned: req.banned };
  const ft = req.freeTransfers;
  const maxHits = req.maxHits ?? 2;

  if (req.squad.length < 15) return completeSquad(base, req);

  const hold = await optimise({ ...base, exactTransfers: 0 });
  if (hold.status !== "Optimal" && hold.status !== "Time limit reached") throw new Error(`Current squad is not valid (${hold.status}). Check positions, club limits and budget.`);

  const runs: { key: string; title: string; description: string; promise: Promise<OptResult> }[] = [];
  for (let k = 1; k <= Math.max(1, Math.min(ft + 1, 3)); k++) {
    runs.push({
      key: `k${k}`,
      title: k === 1 ? "Best single transfer" : `Best ${k} transfers`,
      description: k > ft ? `Includes a -${(k - ft) * 4} hit` : `Uses ${k} of ${ft} free transfer${ft === 1 ? "" : "s"}`,
      promise: optimise({ ...base, exactTransfers: k }),
    });
  }
  runs.push({
    key: "free",
    title: "Solver's choice",
    description: `Any number of transfers up to ${ft + maxHits}, hits charged at 4 points each`,
    promise: optimise({ ...base, maxTransfers: ft + maxHits }),
  });
  if (req.chips?.includes("wildcard")) {
    runs.push({ key: "wildcard", title: "Wildcard", description: "Unlimited free transfers, optimised over the full horizon", promise: optimise({ ...base, freeTransfers: 15, hitCost: 0, maxTransfers: 15 }) });
  }
  if (req.chips?.includes("freehit")) {
    const oneWeek = pool.map((p) => ({ ...p, xp: p.xp.map((v, i) => (i === 0 ? v : 0)) }));
    runs.push({
      key: "freehit",
      title: "Free Hit (next GW only)",
      description: "Unlimited transfers for one week; squad reverts after",
      promise: optimise({ ...base, pool: oneWeek, freeTransfers: 15, hitCost: 0, maxTransfers: 15 }),
    });
  }

  const results = await Promise.all(runs.map((r) => r.promise));
  const holdNext = hold.lineups[0]?.xp ?? 0;
  const scenarios: Scenario[] = [
    { key: "hold", title: "Hold (roll transfer)", description: ft < 5 ? `Bank it: ${Math.min(5, ft + 1)} FT next week` : "No transfers (you're at the 5 FT cap)", result: hold, gainVsHold: 0, nextGwGain: 0 },
  ];
  const seen = new Set<string>([hold.squad.slice().sort().join(",")]);
  results.forEach((res, i) => {
    if (res.status !== "Optimal" && res.status !== "Time limit reached") return;
    const sig = res.squad.slice().sort().join(",");
    const isChip = runs[i].key === "wildcard" || runs[i].key === "freehit";
    if (seen.has(sig) && !isChip) return;
    seen.add(sig);
    const oneWeek = runs[i].key === "freehit";
    scenarios.push({
      key: runs[i].key,
      title: runs[i].title,
      description: runs[i].description,
      result: res,
      // A Free Hit only changes one week, so compare it with the hold lineup for that week.
      gainVsHold: oneWeek ? (res.lineups[0]?.xp ?? 0) - holdNext : res.netPoints - hold.netPoints,
      nextGwGain: (res.lineups[0]?.xp ?? 0) - res.hits * 4 - holdNext,
    });
  });

  // Recommendation among non-chip plans: net gain, crediting the value of a rolled FT.
  const value = (s: Scenario) =>
    s.gainVsHold - s.result.hits * HIT_MARGIN + (s.result.transfersIn.length < ft && ft < 5 ? ROLL_VALUE : 0);
  const pick = scenarios.filter((s) => s.key !== "wildcard" && s.key !== "freehit").sort((a, b) => value(b) - value(a))[0];
  pick.recommended = true;
  const advice =
    pick.key === "hold"
      ? `Roll the transfer: the best move only adds ${Math.max(0, ...scenarios.filter((s) => s.key.startsWith("k")).map((s) => s.gainVsHold)).toFixed(1)} xPts over ${hold.lineups.length} GWs, less than the ~${ROLL_VALUE} a banked transfer is worth.`
      : `${pick.title}: +${pick.gainVsHold.toFixed(1)} xPts over ${hold.lineups.length} GWs${pick.result.hits ? ` after a -${pick.result.hits * 4} hit (clears the extra ${HIT_MARGIN}-pt-per-hit safety margin)` : ""}.`;
  return { scenarios, advice };
}

/** Fewer than 15 players: keep the ones picked and fill the rest optimally within the budget. */
async function completeSquad(
  base: { pool: OptPlayer[]; owned: { id: number; sell: number }[]; bank: number; locked?: number[]; banned?: number[] },
  req: ScenarioRequest,
): Promise<{ scenarios: Scenario[]; advice: string }> {
  const need = 15 - req.squad.length;
  const res = await optimise({
    ...base,
    freeTransfers: 15,
    hitCost: 0,
    exactTransfers: need,
    locked: [...(req.locked ?? []), ...req.squad.map((s) => s.id)],
  });
  if (res.status !== "Optimal" && res.status !== "Time limit reached") {
    throw new Error(`Can't complete this squad within budget (${res.status}). Check positions, club limits and bank.`);
  }
  return {
    scenarios: [
      {
        key: "complete",
        title: req.squad.length ? `Complete squad (+${need})` : "Best squad from scratch",
        description: `Fills ${need} slot${need === 1 ? "" : "s"} to maximise expected points over the horizon`,
        result: res,
        gainVsHold: res.netPoints,
        nextGwGain: res.lineups[0]?.xp ?? 0,
        recommended: true,
      },
    ],
    advice: `Optimal ${need === 15 ? "squad" : "completion"}: ${res.netPoints.toFixed(1)} xPts over ${res.lineups.length} GWs, £${(res.bankAfter / 10).toFixed(1)}m left.`,
  };
}
