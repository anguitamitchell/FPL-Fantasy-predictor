import type { PlayerGw, PlayerPrior, Pos } from "./types";

export interface PositionBaseline {
  // per-90 rates averaged (minutes-weighted) across players in the position
  xg: number;
  xa: number;
  goals: number;
  assists: number;
  bonus: number;
  saves: number;
  dc: number;
  yellow: number;
  avgPrice: number;
}

export interface PlayerRates {
  xg90: number;
  xa90: number;
  goals90: number;
  assists90: number;
  bonus90: number;
  saves90: number;
  dc90: number;
  yellow90: number;
  dcHitRate: number | null; // empirical P(reach DC threshold) in ~full matches, if observed
  dcFullMatches: number;
  startRate: number;
  subRate: number;
  minsIfStart: number;
  minsIfSub: number;
  p60IfStart: number;
  seasonMinutes: number;
}

const RATE_KEYS = ["xg", "xa", "goals", "assists", "bonus", "saves", "dc", "yellow"] as const;
type RateKey = (typeof RATE_KEYS)[number];

export const DC_THRESHOLD: Record<Pos, number> = { GKP: Infinity, DEF: 10, MID: 12, FWD: 12 };

/** Recency weight for a gameweek `ago` GWs before the latest one. */
export const recency = (ago: number, halfLife: number) => Math.pow(0.5, ago / halfLife);

export interface RateOptions {
  attackHalfLife?: number; // GWs
  minutesHalfLife?: number;
  positionPriorMinutes?: number; // pseudo-minutes of the position/price prior
  lastSeasonWeight?: number; // fraction of last season's minutes counted as pseudo-minutes
  lastSeasonCapMinutes?: number;
  priceElasticity?: number; // how strongly price scales the attacking prior
}

export function estimateRates(
  pos: Pos,
  price: number,
  history: PlayerGw[],
  latestGw: number,
  prior: PlayerPrior | null,
  baseline: PositionBaseline,
  opts: RateOptions = {},
): PlayerRates {
  const aHL = opts.attackHalfLife ?? 8;
  const mHL = opts.minutesHalfLife ?? 2; // backtest-tuned (GW2-6 2026/27)
  const posMin = opts.positionPriorMinutes ?? 360;
  const lsW = opts.lastSeasonWeight ?? 0.5;
  const lsCap = opts.lastSeasonCapMinutes ?? 2700;
  const elasticity = opts.priceElasticity ?? 1.3;

  // --- per-90 rates: recency-weighted season data + last-season prior + position/price prior
  const priceMult = Math.min(2.5, Math.max(0.4, Math.pow(price / baseline.avgPrice, elasticity)));
  const acc: Record<RateKey, number> = { xg: 0, xa: 0, goals: 0, assists: 0, bonus: 0, saves: 0, dc: 0, yellow: 0 };
  let w90 = 0;
  for (const h of history) {
    if (h.minutes <= 0) continue;
    const w = recency(latestGw - h.gw, aHL);
    acc.xg += w * h.xg;
    acc.xa += w * h.xa;
    acc.goals += w * h.goals;
    acc.assists += w * h.assists;
    acc.bonus += w * h.bonus;
    acc.saves += w * h.saves;
    acc.dc += w * h.dc;
    acc.yellow += w * (h.yellow ?? 0);
    w90 += (w * h.minutes) / 90;
  }
  const lsMin = prior && prior.minutes > 0 ? Math.min(prior.minutes, lsCap) * lsW : 0;
  const rate = (k: RateKey) => {
    const posRate = baseline[k] * (k === "xg" || k === "xa" || k === "goals" || k === "assists" ? priceMult : 1);
    const lsRate = prior && prior.minutes > 0 ? (prior[k] / prior.minutes) * 90 : 0;
    return (acc[k] + (lsMin / 90) * lsRate + (posMin / 90) * posRate) / (w90 + lsMin / 90 + posMin / 90);
  };

  // --- empirical DC threshold hit rate in single-fixture, near-full matches
  const th = DC_THRESHOLD[pos];
  let dcHits = 0;
  let dcFull = 0;
  for (const h of history) {
    if (h.fixtures === 1 && h.minutes >= 80) {
      dcFull++;
      if (h.dc >= th) dcHits++;
    }
  }

  // --- minutes model (shorter memory: role changes matter quickly)
  let wFix = 0;
  let wStarts = 0;
  let wNonStart = 0;
  let wSubApps = 0;
  let startMinSum = 0;
  let startMinW = 0;
  let subMinSum = 0;
  let subMinW = 0;
  let full60 = 0;
  let full60W = 0;
  for (const h of history) {
    if (h.fixtures <= 0) continue;
    const w = recency(latestGw - h.gw, mHL);
    wFix += w * h.fixtures;
    wStarts += w * Math.min(h.starts, h.fixtures);
    const nonStarts = h.fixtures - Math.min(h.starts, h.fixtures);
    wNonStart += w * nonStarts;
    if (h.fixtures === 1) {
      if (h.starts === 1) {
        startMinSum += w * h.minutes;
        startMinW += w;
        full60 += w * (h.minutes >= 60 ? 1 : 0);
        full60W += w;
      } else if (h.minutes > 0) {
        wSubApps += w;
        subMinSum += w * h.minutes;
        subMinW += w;
      }
    }
  }
  // Prior start rate from last season (fraction of 38 started), else a cautious 0.25.
  const priorStart = prior && prior.minutes > 0 ? Math.min(0.95, prior.starts / 38) : 0.25;
  const priorGames = 2;
  const startRate = (wStarts + priorGames * priorStart) / (wFix + priorGames);
  const subRate = (wSubApps + 1 * 0.35) / (wNonStart + 1);
  const minsIfStart = (startMinSum + 2 * 80) / (startMinW + 2);
  const minsIfSub = (subMinSum + 2 * 20) / (subMinW + 2);
  const p60IfStart = (full60 + 2 * 0.85) / (full60W + 2);

  return {
    xg90: rate("xg"),
    xa90: rate("xa"),
    goals90: rate("goals"),
    assists90: rate("assists"),
    bonus90: rate("bonus"),
    saves90: rate("saves"),
    dc90: rate("dc"),
    yellow90: rate("yellow"),
    dcHitRate: dcFull > 0 ? dcHits / dcFull : null,
    dcFullMatches: dcFull,
    startRate,
    subRate,
    minsIfStart,
    minsIfSub,
    p60IfStart,
    seasonMinutes: history.reduce((s, h) => s + h.minutes, 0),
  };
}

/** Minutes-weighted per-90 averages for one position, from regulars (>= 270 mins). */
export function positionBaseline(
  players: { price: number; history: PlayerGw[] }[],
): PositionBaseline {
  let mins = 0;
  const sum = { xg: 0, xa: 0, goals: 0, assists: 0, bonus: 0, saves: 0, dc: 0, yellow: 0 };
  let priceSum = 0;
  let n = 0;
  for (const p of players) {
    const m = p.history.reduce((s, h) => s + h.minutes, 0);
    if (m < 270) continue;
    priceSum += p.price;
    n++;
    mins += m;
    for (const h of p.history) {
      sum.xg += h.xg;
      sum.xa += h.xa;
      sum.goals += h.goals;
      sum.assists += h.assists;
      sum.bonus += h.bonus;
      sum.saves += h.saves;
      sum.dc += h.dc;
      sum.yellow += h.yellow ?? 0;
    }
  }
  const per90 = (v: number) => (mins > 0 ? (v / mins) * 90 : 0);
  return {
    xg: per90(sum.xg),
    xa: per90(sum.xa),
    goals: per90(sum.goals),
    assists: per90(sum.assists),
    bonus: per90(sum.bonus),
    saves: per90(sum.saves),
    dc: per90(sum.dc),
    yellow: per90(sum.yellow),
    avgPrice: n > 0 ? priceSum / n : 50,
  };
}
