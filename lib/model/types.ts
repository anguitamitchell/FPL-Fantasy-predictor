export type Pos = "GKP" | "DEF" | "MID" | "FWD";
export const POS_BY_TYPE: Record<number, Pos> = { 1: "GKP", 2: "DEF", 3: "MID", 4: "FWD" };

/** One gameweek of a player's season (summed over fixtures in a double GW). */
export interface PlayerGw {
  gw: number;
  fixtures: number; // fixtures the player's team had (0 = blank)
  minutes: number;
  starts: number;
  xg: number;
  xa: number;
  goals: number;
  assists: number;
  bonus: number;
  bps: number;
  saves: number;
  dc: number;
  yellow?: number;
  points: number;
}

export interface TeamRating {
  team: number;
  attack: number; // multiplier on league-average goals scored
  defence: number; // multiplier on league-average goals conceded (higher = leakier)
}

export interface TeamRatings {
  ratings: Map<number, TeamRating>;
  mu: number; // league-average goals per team per match (neutral venue)
  home: number; // home multiplier (away = 1 / home)
}

/** Season-prior per-90 rates (usually last season's totals). */
export interface PlayerPrior {
  minutes: number;
  starts: number;
  xg: number;
  xa: number;
  goals: number;
  assists: number;
  bonus: number;
  saves: number;
  dc: number | null; // null when the stat wasn't tracked that season
  yellow: number;
}

export interface FixtureProjection {
  gw: number;
  fixtureId: number;
  opponent: number;
  home: boolean;
  lambdaFor: number;
  lambdaAgainst: number;
  pPlay: number;
  p60: number;
  expMinutes: number;
  components: {
    appearance: number;
    goals: number;
    assists: number;
    cleanSheet: number;
    goalsConceded: number;
    saves: number;
    defCon: number;
    bonus: number;
    cards: number;
  };
  xpts: number;
}

export interface PlayerProjection {
  id: number;
  byGw: Record<number, number>; // summed over fixtures in that GW (0 for a blank)
  fixtures: FixtureProjection[];
  total: number; // sum over horizon
}
