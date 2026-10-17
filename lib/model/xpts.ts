import type { Scoring } from "@/lib/fpl/schemas";
import { expectedFloorDiv, negBinAtLeast } from "./poisson";
import { DC_THRESHOLD, type PlayerRates } from "./playerRates";
import type { FixtureProjection, Pos } from "./types";

export const DC_DISPERSION = 1.4; // variance/mean of per-match DC counts (calibrated on 2026/27 GW1-6)

export interface FixtureContext {
  gw: number;
  fixtureId: number;
  opponent: number;
  home: boolean;
  lambdaFor: number; // team's expected goals in this fixture
  lambdaAgainst: number; // opponent's expected goals
  teamAvgFor: number; // team's expected goals vs an average opponent at a neutral venue
  teamAvgAgainst: number;
  availability: number; // 0..1
  minutesMultiplier?: number; // fixture congestion / rotation adjustment (1 = none)
}

/** P(reaching the DC threshold) in a match of `mins` minutes. */
export function dcHitProbability(pos: Pos, rates: PlayerRates, mins: number): number {
  const th = DC_THRESHOLD[pos];
  if (!Number.isFinite(th)) return 0;
  const model = negBinAtLeast(th, (rates.dc90 * mins) / 90, DC_DISPERSION);
  if (rates.dcHitRate === null) return model;
  // Blend in the player's observed hit rate (k = 4 pseudo-matches of the model estimate).
  const k = 4;
  return (rates.dcHitRate * rates.dcFullMatches + model * k) / (rates.dcFullMatches + k);
}

export function projectFixture(pos: Pos, rates: PlayerRates, ctx: FixtureContext, scoring: Scoring): FixtureProjection {
  const mm = ctx.minutesMultiplier ?? 1;
  const pStart = ctx.availability * rates.startRate * mm;
  const pSub = ctx.availability * (1 - rates.startRate * mm) * rates.subRate;
  const pPlay = pStart + pSub;
  const p60 = pStart * rates.p60IfStart;
  const expMinutes = pStart * rates.minsIfStart + pSub * rates.minsIfSub;
  const m90 = expMinutes / 90;

  // How much easier/harder this fixture is than the team's average one.
  const attackMult = ctx.teamAvgFor > 0 ? ctx.lambdaFor / ctx.teamAvgFor : 1;
  const concedeMult = ctx.teamAvgAgainst > 0 ? ctx.lambdaAgainst / ctx.teamAvgAgainst : 1;

  const goalRate = 0.8 * rates.xg90 + 0.2 * rates.goals90;
  const assistRate = 0.7 * rates.xa90 + 0.3 * rates.assists90;

  const appearance = pPlay * scoring.short_play + p60 * (scoring.long_play - scoring.short_play);
  const goals = goalRate * m90 * attackMult * scoring.goals_scored[pos];
  const assists = assistRate * m90 * attackMult * scoring.assists;
  const pCleanSheet = Math.exp(-ctx.lambdaAgainst);
  const cleanSheet = p60 * pCleanSheet * scoring.clean_sheets[pos];

  // Goals conceded (-1 per 2) only counts while on the pitch; approximate with starts.
  const gcLambda = (ctx.lambdaAgainst * rates.minsIfStart) / 90;
  const goalsConceded = pStart * expectedFloorDiv(gcLambda, 2) * scoring.goals_conceded[pos];

  let saves = 0;
  if (pos === "GKP") {
    const saveMean = ((rates.saves90 * rates.minsIfStart) / 90) * concedeMult;
    saves = pStart * expectedFloorDiv(saveMean, 3) * scoring.saves;
  }

  const defCon = pStart * dcHitProbability(pos, rates, rates.minsIfStart) * scoring.defensive_contribution[pos];

  // Bonus tracks attacking returns for MID/FWD and clean sheets for GK/DEF.
  const bonusMult =
    pos === "MID" || pos === "FWD"
      ? Math.sqrt(attackMult)
      : Math.sqrt(pCleanSheet / Math.max(0.05, Math.exp(-ctx.teamAvgAgainst)));
  const bonus = rates.bonus90 * m90 * bonusMult * scoring.bonus;
  const cards = rates.yellow90 * m90 * scoring.yellow_cards;

  const components = { appearance, goals, assists, cleanSheet, goalsConceded, saves, defCon, bonus, cards };
  const xpts = Object.values(components).reduce((s, v) => s + v, 0);
  return {
    gw: ctx.gw,
    fixtureId: ctx.fixtureId,
    opponent: ctx.opponent,
    home: ctx.home,
    lambdaFor: ctx.lambdaFor,
    lambdaAgainst: ctx.lambdaAgainst,
    pPlay,
    p60,
    expMinutes,
    components,
    xpts,
  };
}
