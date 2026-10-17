import type { FixtureProjection, Pos } from "./types";
import type { Scoring } from "@/lib/fpl/schemas";

/** Deterministic PRNG so the same inputs always give the same haul probabilities. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function poissonSample(lambda: number, rnd: () => number): number {
  if (lambda <= 0) return 0;
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rnd();
  } while (p > L);
  return k - 1;
}

/**
 * Monte Carlo distribution of a gameweek's points from its fixture projections.
 * Returns P(points >= threshold) and the 90th percentile ("ceiling").
 */
export function haulStats(
  fixtures: FixtureProjection[],
  pos: Pos,
  scoring: Scoring,
  seed: number,
  threshold = 10,
  sims = 3000,
): { pHaul: number; p90: number } {
  if (fixtures.length === 0) return { pHaul: 0, p90: 0 };
  const rnd = mulberry32(seed);
  const totals: number[] = [];
  let hauls = 0;
  for (let s = 0; s < sims; s++) {
    let pts = 0;
    for (const f of fixtures) {
      const c = f.components;
      if (rnd() >= f.pPlay) continue;
      // Condition on playing: rescale per-90-driven components by 1/pPlay.
      const k = f.pPlay > 0 ? 1 / f.pPlay : 0;
      const sixty = rnd() < (f.pPlay > 0 ? f.p60 / f.pPlay : 0);
      pts += sixty ? scoring.long_play : scoring.short_play;
      const g = poissonSample((c.goals * k) / scoring.goals_scored[pos], rnd);
      const a = poissonSample((c.assists * k) / scoring.assists, rnd);
      pts += g * scoring.goals_scored[pos] + a * scoring.assists;
      if (sixty && scoring.clean_sheets[pos] > 0 && f.p60 > 0) {
        if (rnd() < c.cleanSheet / (f.p60 * scoring.clean_sheets[pos])) pts += scoring.clean_sheets[pos];
      }
      // Smaller components: add their conditional expectation (keeps the sim cheap).
      pts += (c.goalsConceded + c.saves + c.defCon + c.cards) * k;
      // Bonus mostly follows returns.
      pts += Math.min(3, g + a > 0 ? 1 + g : (c.bonus * k) / 2);
    }
    totals.push(pts);
    if (pts >= threshold) hauls++;
  }
  totals.sort((x, y) => x - y);
  return { pHaul: hauls / sims, p90: totals[Math.floor(sims * 0.9)] };
}
