import type { TeamRating, TeamRatings } from "./types";

export interface MatchObs {
  home: number;
  away: number;
  homeGoals: number; // blended xG / actual goals
  awayGoals: number;
  weight: number; // recency weight
}

export interface TeamPrior {
  team: number;
  attack: number;
  defence: number;
}

/**
 * Multiplicative attack/defence model: E[goals_i vs j] = mu * att_i * def_j * home^(±1).
 * Fitted by iterative proportional scaling with K pseudo-matches pulling each team to its prior.
 */
export function fitTeamRatings(
  teams: number[],
  matches: MatchObs[],
  priors: Map<number, TeamPrior>,
  opts: { pseudoMatches?: number; iterations?: number; defaultMu?: number } = {},
): TeamRatings {
  const K = opts.pseudoMatches ?? 6;
  const iters = opts.iterations ?? 50;

  const totalW = matches.reduce((s, m) => s + m.weight, 0);
  const goalsW = matches.reduce((s, m) => s + m.weight * (m.homeGoals + m.awayGoals), 0);
  const mu = totalW > 0 ? goalsW / (2 * totalW) : (opts.defaultMu ?? 1.4);
  const homeW = matches.reduce((s, m) => s + m.weight * m.homeGoals, 0);
  const awayW = matches.reduce((s, m) => s + m.weight * m.awayGoals, 0);
  // Shrink the home ratio towards a typical 1.1 with 60 pseudo-matches.
  const rawHome = awayW > 0 ? Math.sqrt(homeW / awayW) : 1.1;
  const home = (rawHome * totalW + 1.1 * 60) / (totalW + 60);

  const att = new Map<number, number>();
  const def = new Map<number, number>();
  for (const t of teams) {
    att.set(t, priors.get(t)?.attack ?? 1);
    def.set(t, priors.get(t)?.defence ?? 1);
  }

  for (let it = 0; it < iters; it++) {
    for (const t of teams) {
      let num = K * mu * (priors.get(t)?.attack ?? 1);
      let den = K * mu;
      for (const m of matches) {
        if (m.home === t) {
          num += m.weight * m.homeGoals;
          den += m.weight * mu * def.get(m.away)! * home;
        } else if (m.away === t) {
          num += m.weight * m.awayGoals;
          den += m.weight * mu * def.get(m.home)! / home;
        }
      }
      att.set(t, num / den);
    }
    for (const t of teams) {
      let num = K * mu * (priors.get(t)?.defence ?? 1);
      let den = K * mu;
      for (const m of matches) {
        if (m.home === t) {
          num += m.weight * m.awayGoals;
          den += m.weight * mu * att.get(m.away)! / home;
        } else if (m.away === t) {
          num += m.weight * m.homeGoals;
          den += m.weight * mu * att.get(m.home)! * home;
        }
      }
      def.set(t, num / den);
    }
    // Normalise so the geometric means are 1 (keeps mu interpretable).
    const gm = (m: Map<number, number>) => Math.exp(teams.reduce((s, t) => s + Math.log(m.get(t)!), 0) / teams.length);
    const ga = gm(att);
    const gd = gm(def);
    for (const t of teams) {
      att.set(t, att.get(t)! / ga);
      def.set(t, def.get(t)! / gd);
    }
  }

  const ratings = new Map<number, TeamRating>();
  for (const t of teams) ratings.set(t, { team: t, attack: att.get(t)!, defence: def.get(t)! });
  return { ratings, mu, home };
}

/** Expected goals for `team` against `opp`. */
export function expectedGoals(r: TeamRatings, team: number, opp: number, isHome: boolean): number {
  const a = r.ratings.get(team)?.attack ?? 1;
  const d = r.ratings.get(opp)?.defence ?? 1;
  return r.mu * a * d * (isHome ? r.home : 1 / r.home);
}
