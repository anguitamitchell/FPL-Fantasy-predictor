import type { Bootstrap, Element, Fixture, Live } from "@/lib/fpl/schemas";
import { availability } from "./availability";
import { estimateRates, positionBaseline, recency, type PlayerRates, type PositionBaseline, type RateOptions } from "./playerRates";
import { expectedGoals, fitTeamRatings, type MatchObs, type TeamPrior } from "./teamRatings";
import { projectFixture } from "./xpts";
import { POS_BY_TYPE, type FixtureProjection, type PlayerGw, type PlayerPrior, type Pos, type TeamRatings } from "./types";

export interface ModelInput {
  bootstrap: Bootstrap;
  fixtures: Fixture[];
  lives: Map<number, Live>; // finished gameweeks only
  priors: Map<number, PlayerPrior>; // keyed by element `code` (stable across seasons)
  now: Date;
  horizon: number;
  startGw?: number; // first GW to project (defaults to the next GW)
  /** Optional rotation/fatigue multipliers on P(start), keyed `${teamId}:${fixtureId}`. */
  minutesMultipliers?: Map<string, number>;
  /** Optional per-player multipliers on attacking rates from other competitions. */
  attackAdjust?: Map<number, number>;
  rateOptions?: RateOptions;
}

export interface PlayerModel {
  element: Element;
  pos: Pos;
  rates: PlayerRates;
  history: PlayerGw[];
  fixtures: FixtureProjection[];
  byGw: Record<number, number>;
  total: number;
}

export interface ModelOutput {
  gws: number[];
  ratings: TeamRatings;
  players: Map<number, PlayerModel>;
  baselines: Record<Pos, PositionBaseline>;
  latestGw: number;
}

const POSITIONS: Pos[] = ["GKP", "DEF", "MID", "FWD"];

/** Builds each player's per-GW history from the event/live payloads. */
export function buildHistories(bootstrap: Bootstrap, fixtures: Fixture[], lives: Map<number, Live>) {
  const teamFixturesInGw = new Map<string, number>();
  for (const f of fixtures) {
    if (f.event == null) continue;
    for (const t of [f.team_h, f.team_a]) {
      const k = `${t}:${f.event}`;
      teamFixturesInGw.set(k, (teamFixturesInGw.get(k) ?? 0) + 1);
    }
  }
  const teamOf = new Map(bootstrap.elements.map((e) => [e.id, e.team]));
  const histories = new Map<number, PlayerGw[]>();
  for (const e of bootstrap.elements) histories.set(e.id, []);
  const gws = [...lives.keys()].sort((a, b) => a - b);
  for (const gw of gws) {
    for (const row of lives.get(gw)!.elements) {
      const team = teamOf.get(row.id);
      if (team === undefined) continue;
      const s = row.stats;
      histories.get(row.id)!.push({
        gw,
        fixtures: teamFixturesInGw.get(`${team}:${gw}`) ?? 0,
        minutes: s.minutes,
        starts: s.starts,
        xg: s.expected_goals,
        xa: s.expected_assists,
        goals: s.goals_scored,
        assists: s.assists,
        bonus: s.bonus,
        bps: s.bps,
        saves: s.saves,
        dc: s.defensive_contribution,
        yellow: s.yellow_cards ?? 0,
        points: s.total_points,
      });
    }
  }
  return { histories, teamFixturesInGw };
}

/** Team-level match observations: team xG summed from players, blended with actual goals. */
export function buildMatchObs(
  bootstrap: Bootstrap,
  fixtures: Fixture[],
  lives: Map<number, Live>,
  teamFixturesInGw: Map<string, number>,
  latestGw: number,
  halfLife = 10,
): MatchObs[] {
  const teamOf = new Map(bootstrap.elements.map((e) => [e.id, e.team]));
  const teamXg = new Map<string, number>(); // `${team}:${gw}` -> xG
  for (const [gw, live] of lives) {
    for (const row of live.elements) {
      const team = teamOf.get(row.id);
      if (team === undefined) continue;
      const k = `${team}:${gw}`;
      teamXg.set(k, (teamXg.get(k) ?? 0) + row.stats.expected_goals);
    }
  }
  const obs: MatchObs[] = [];
  for (const f of fixtures) {
    if (f.event == null || !f.finished || !lives.has(f.event)) continue;
    const per = (t: number) => (teamXg.get(`${t}:${f.event}`) ?? 0) / (teamFixturesInGw.get(`${t}:${f.event}`) ?? 1);
    const hx = per(f.team_h);
    const ax = per(f.team_a);
    obs.push({
      home: f.team_h,
      away: f.team_a,
      homeGoals: 0.7 * hx + 0.3 * (f.team_h_score ?? hx),
      awayGoals: 0.7 * ax + 0.3 * (f.team_a_score ?? ax),
      weight: recency(latestGw - f.event, halfLife),
    });
  }
  return obs;
}

/** FPL's 1–5 "strength_overall" gives a weak pre-season prior for team ratings. */
export function teamPriors(bootstrap: Bootstrap): Map<number, TeamPrior> {
  const m = new Map<number, TeamPrior>();
  for (const t of bootstrap.teams) {
    const s = ((t.strength_overall_home ?? 3) + (t.strength_overall_away ?? 3)) / 2;
    m.set(t.id, { team: t.id, attack: Math.exp(0.18 * (s - 3)), defence: Math.exp(-0.18 * (s - 3)) });
  }
  return m;
}

export function buildModel(input: ModelInput): ModelOutput {
  const { bootstrap, fixtures, lives, priors, now, horizon } = input;
  const events = bootstrap.events;
  const latestGw = Math.max(0, ...lives.keys());
  const startGw =
    input.startGw ?? events.find((e) => e.is_next)?.id ?? Math.min(38, (events.find((e) => e.is_current)?.id ?? 0) + 1);
  const gws: number[] = [];
  for (let g = startGw; g < startGw + horizon && g <= 38; g++) gws.push(g);

  const { histories, teamFixturesInGw } = buildHistories(bootstrap, fixtures, lives);
  const ratings = fitTeamRatings(
    bootstrap.teams.map((t) => t.id),
    buildMatchObs(bootstrap, fixtures, lives, teamFixturesInGw, latestGw),
    teamPriors(bootstrap),
  );

  const baselines = {} as Record<Pos, PositionBaseline>;
  for (const pos of POSITIONS) {
    baselines[pos] = positionBaseline(
      bootstrap.elements
        .filter((e) => POS_BY_TYPE[e.element_type] === pos)
        .map((e) => ({ price: e.now_cost, history: histories.get(e.id) ?? [] })),
    );
  }

  const deadlines = new Map(events.map((e) => [e.id, new Date(e.deadline_time)]));
  const upcoming = fixtures.filter((f) => f.event != null && gws.includes(f.event));

  const players = new Map<number, PlayerModel>();
  for (const el of bootstrap.elements) {
    const pos = POS_BY_TYPE[el.element_type];
    if (!pos) continue; // managers or unknown types
    const history = histories.get(el.id) ?? [];
    const rates = estimateRates(pos, el.now_cost, history, latestGw, priors.get(el.code) ?? null, baselines[pos], input.rateOptions);
    const adj = input.attackAdjust?.get(el.id);
    if (adj) {
      rates.xg90 *= adj;
      rates.xa90 *= adj;
    }
    const teamAvgFor = expectedGoals(ratings, el.team, -1, true) / ratings.home; // neutral, avg opponent
    const teamAvgAgainst = ratings.mu * (ratings.ratings.get(el.team)?.defence ?? 1);

    const fx: FixtureProjection[] = [];
    for (const f of upcoming) {
      if (f.team_h !== el.team && f.team_a !== el.team) continue;
      const home = f.team_h === el.team;
      const opp = home ? f.team_a : f.team_h;
      const offset = gws.indexOf(f.event!);
      fx.push(
        projectFixture(
          pos,
          rates,
          {
            gw: f.event!,
            fixtureId: f.id,
            opponent: opp,
            home,
            lambdaFor: expectedGoals(ratings, el.team, opp, home),
            lambdaAgainst: expectedGoals(ratings, opp, el.team, !home),
            teamAvgFor,
            teamAvgAgainst,
            availability: availability(
              { status: el.status, chance: el.chance_of_playing_next_round, news: el.news },
              offset,
              deadlines.get(f.event!) ?? now,
              now,
            ),
            minutesMultiplier: input.minutesMultipliers?.get(`${el.team}:${f.id}`),
          },
          bootstrap.game_config.scoring,
        ),
      );
    }
    fx.sort((a, b) => a.gw - b.gw);
    const byGw: Record<number, number> = {};
    for (const g of gws) byGw[g] = 0;
    for (const p of fx) byGw[p.gw] += p.xpts;
    const total = Object.values(byGw).reduce((s, v) => s + v, 0);
    players.set(el.id, { element: el, pos, rates, history, fixtures: fx, byGw, total });
  }

  return { gws, ratings, players, baselines, latestGw };
}
