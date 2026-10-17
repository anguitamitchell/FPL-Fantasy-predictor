import type { ModelOutput, PlayerModel } from "@/lib/model/build";
import { haulStats } from "@/lib/model/haul";
import type { Pos } from "@/lib/model/types";
import type { SeasonData } from "./season";

export interface FixtureCell {
  gw: number;
  opp: string;
  home: boolean;
  /** Expected goal difference for the team in this fixture (positive = favourable). */
  ease: number;
}

export interface PlayerRow {
  id: number;
  code: number;
  name: string;
  fullName: string;
  team: number;
  teamShort: string;
  pos: Pos;
  price: number; // £m
  ownership: number; // %
  form: number;
  status: string;
  news: string;
  chance: number | null;
  epNext: number | null;
  xpts: number; // horizon total
  byGw: number[]; // aligned to AppData.gws
  next: number; // first projected GW
  xptsPerM: number;
  pPlay: number; // first fixture
  expMins: number;
  pHaul: number; // P(>=10) in next GW
  ceiling: number; // 90th percentile points next GW
  components: Record<string, number>; // horizon sums
  fixtures: FixtureCell[];
  season: {
    points: number;
    minutes: number;
    starts: number;
    goals: number;
    assists: number;
    xg: number;
    xa: number;
    xgi90: number;
    ppg: number;
    bonus: number;
    dc: number;
  };
  netTransfersGw: number;
  priceTrend: { percent: number; tonight: number; likelihood: number } | null;
  /** Hasn't played and isn't expected to: hidden from most lists but kept for squads. */
  inactive: boolean;
  ext?: { comps: number; mins14d: number; minutesFactor: number; form90: number | null; label: string | null };
}

export interface TeamRow {
  id: number;
  short: string;
  name: string;
  attack: number;
  defence: number;
  fixtures: FixtureCell[];
}

export interface AppData {
  gws: number[];
  nextGw: number;
  deadline: string | null;
  latestGw: number;
  updatedAt: string;
  players: PlayerRow[];
  teams: TeamRow[];
  totalManagers: number;
}

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

export function toAppData(m: ModelOutput & SeasonData, extInfo?: Map<number, PlayerRow["ext"]>): AppData {
  const { bootstrap, fixtures, gws, ratings } = m;
  const teamShort = new Map(bootstrap.teams.map((t) => [t.id, t.short_name]));
  const scoring = bootstrap.game_config.scoring;
  const g0 = gws[0];

  const ease = (team: number, f: { lambdaFor: number; lambdaAgainst: number }) => round(f.lambdaFor - f.lambdaAgainst);

  const teams: TeamRow[] = bootstrap.teams.map((t) => {
    const r = ratings.ratings.get(t.id)!;
    const cells: FixtureCell[] = [];
    for (const f of fixtures) {
      if (f.event == null || !gws.includes(f.event)) continue;
      if (f.team_h !== t.id && f.team_a !== t.id) continue;
      const home = f.team_h === t.id;
      const opp = home ? f.team_a : f.team_h;
      const ro = ratings.ratings.get(opp)!;
      const lf = ratings.mu * r.attack * ro.defence * (home ? ratings.home : 1 / ratings.home);
      const la = ratings.mu * ro.attack * r.defence * (home ? 1 / ratings.home : ratings.home);
      cells.push({ gw: f.event, opp: teamShort.get(opp)!, home, ease: ease(t.id, { lambdaFor: lf, lambdaAgainst: la }) });
    }
    cells.sort((a, b) => a.gw - b.gw);
    return { id: t.id, short: t.short_name, name: t.name, attack: round(r.attack), defence: round(r.defence), fixtures: cells };
  });

  const players: PlayerRow[] = [];
  for (const p of m.players.values()) {
    const e = p.element;
    const firstFx = p.fixtures[0];
    const comps: Record<string, number> = {};
    for (const f of p.fixtures) for (const [k, v] of Object.entries(f.components)) comps[k] = (comps[k] ?? 0) + v;
    for (const k of Object.keys(comps)) comps[k] = round(comps[k]);
    const nextFixtures = p.fixtures.filter((f) => f.gw === g0);
    const haul = haulStats(nextFixtures, p.pos, scoring, e.id);
    const proj = e.price_change_projections?.[0];
    players.push({
      id: e.id,
      code: e.code,
      name: e.web_name,
      fullName: `${e.first_name} ${e.second_name}`,
      team: e.team,
      teamShort: teamShort.get(e.team)!,
      pos: p.pos,
      price: e.now_cost / 10,
      ownership: e.selected_by_percent,
      form: e.form,
      status: e.status,
      news: e.news,
      chance: e.chance_of_playing_next_round,
      epNext: e.ep_next,
      xpts: round(p.total),
      byGw: gws.map((g) => round(p.byGw[g] ?? 0)),
      next: round(p.byGw[g0] ?? 0),
      xptsPerM: round(p.total / (e.now_cost / 10), 3),
      pPlay: round(firstFx?.pPlay ?? 0),
      expMins: Math.round(firstFx?.expMinutes ?? 0),
      pHaul: round(haul.pHaul, 3),
      ceiling: round(haul.p90, 1),
      components: comps,
      fixtures: p.fixtures.map((f) => ({ gw: f.gw, opp: teamShort.get(f.opponent)!, home: f.home, ease: ease(e.team, f) })),
      season: seasonStats(p),
      netTransfersGw: e.transfers_in_event - e.transfers_out_event,
      priceTrend:
        e.price_change_percent != null
          ? { percent: e.price_change_percent, tonight: proj?.projected_percent ?? e.price_change_percent, likelihood: proj?.likelihood ?? 0 }
          : null,
      inactive: p.rates.seasonMinutes === 0 && (firstFx?.pPlay ?? 0) < 0.15 && p.total < 0.5,
      ext: extInfo?.get(e.id),
    });
  }
  players.sort((a, b) => b.xpts - a.xpts);

  const nextEvent = bootstrap.events.find((ev) => ev.id === g0);
  return {
    gws,
    nextGw: g0,
    deadline: nextEvent?.deadline_time ?? null,
    latestGw: m.latestGw,
    updatedAt: new Date().toISOString(),
    players,
    teams,
    totalManagers: bootstrap.total_players,
  };
}

function seasonStats(p: PlayerModel): PlayerRow["season"] {
  const e = p.element;
  return {
    points: e.total_points,
    minutes: e.minutes,
    starts: e.starts,
    goals: e.goals_scored,
    assists: e.assists,
    xg: round(e.expected_goals),
    xa: round(e.expected_assists),
    xgi90: e.minutes > 0 ? round((e.expected_goal_involvements / e.minutes) * 90) : 0,
    ppg: e.points_per_game,
    bonus: e.bonus,
    dc: e.defensive_contribution,
  };
}
