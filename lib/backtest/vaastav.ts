import { readFileSync } from "fs";
import type { Bootstrap, Element, Fixture, Live, Scoring } from "@/lib/fpl/schemas";
import type { PlayerPrior } from "@/lib/model/types";

/**
 * Adapter for the public vaastav/Fantasy-Premier-League dataset (per-fixture GW rows),
 * turning a past season into the same inputs the live model uses. Offline/backtest only.
 */

function parseCsv(path: string): Record<string, string>[] {
  const text = readFileSync(path, "utf8").replace(/\r/g, "");
  const lines = text.split("\n").filter(Boolean);
  const split = (line: string) => {
    const out: string[] = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (q && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = !q;
      } else if (ch === "," && !q) {
        out.push(cur);
        cur = "";
      } else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const header = split(lines[0]);
  return lines.slice(1).map((l) => {
    const cells = split(l);
    return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""]));
  });
}

const n = (v: string | undefined) => {
  const x = v === undefined || v === "" ? 0 : Number(v);
  return Number.isFinite(x) ? x : 0;
};
const POS: Record<string, number> = { GK: 1, GKP: 1, DEF: 2, MID: 3, FWD: 4, AM: 3 };

export interface PastSeason {
  bootstrapAt: (gw: number) => Bootstrap; // squads/prices as of that GW
  fixtures: Fixture[];
  lives: Map<number, Live>;
  priors: Map<number, PlayerPrior>;
  fplXp: Map<number, Map<number, number>>; // gw -> element -> FPL's own xP
}

export function loadPastSeason(dir: string, priorDir: string | null, scoring: Scoring): PastSeason {
  const gwRows = parseCsv(`${dir}/merged_gw.csv`);
  const teams = parseCsv(`${dir}/teams.csv`);
  const players = parseCsv(`${dir}/players_raw.csv`);
  const fx = parseCsv(`${dir}/fixtures.csv`);

  const teamIdByName = new Map(teams.map((t) => [t.name, Number(t.id)]));
  // FPL's strength scale changed between seasons; rescale to the 2..5 range the model expects.
  const strengths = teams.map((t) => (n(t.strength_overall_home) + n(t.strength_overall_away)) / 2);
  const sMin = Math.min(...strengths);
  const sMax = Math.max(...strengths);
  const scale = (v: number) => (sMax > sMin ? 2 + (3 * (v - sMin)) / (sMax - sMin) : 3);

  const fixtures: Fixture[] = fx.map((f) => ({
    id: n(f.id),
    event: f.event ? n(f.event) : null,
    team_h: n(f.team_h),
    team_a: n(f.team_a),
    team_h_score: f.team_h_score === "" ? null : n(f.team_h_score),
    team_a_score: f.team_a_score === "" ? null : n(f.team_a_score),
    team_h_difficulty: n(f.team_h_difficulty),
    team_a_difficulty: n(f.team_a_difficulty),
    kickoff_time: f.kickoff_time || null,
    started: true,
    finished: f.finished === "True",
    finished_provisional: true,
  }));

  // Per-GW live payloads and per-GW state (team, price) per element.
  const lives = new Map<number, Live>();
  const state = new Map<number, Map<number, { team: number; value: number }>>(); // element -> gw -> state
  const fplXp = new Map<number, Map<number, number>>();
  const acc = new Map<string, Live["elements"][number]>();
  for (const r of gwRows) {
    const gw = n(r.GW || r.round);
    const id = n(r.element);
    const team = teamIdByName.get(r.team) ?? 0;
    if (!state.has(id)) state.set(id, new Map());
    state.get(id)!.set(gw, { team, value: n(r.value) });
    if (!fplXp.has(gw)) fplXp.set(gw, new Map());
    fplXp.get(gw)!.set(id, (fplXp.get(gw)!.get(id) ?? 0) + n(r.xP));
    const key = `${gw}:${id}`;
    const cur = acc.get(key) ?? {
      id,
      explain: [],
      stats: {
        minutes: 0, goals_scored: 0, assists: 0, clean_sheets: 0, goals_conceded: 0, saves: 0, bonus: 0, bps: 0, starts: 0,
        defensive_contribution: 0, expected_goals: 0, expected_assists: 0, expected_goals_conceded: 0, yellow_cards: 0, total_points: 0,
      },
    };
    const s = cur.stats;
    s.minutes += n(r.minutes);
    s.goals_scored += n(r.goals_scored);
    s.assists += n(r.assists);
    s.clean_sheets += n(r.clean_sheets);
    s.goals_conceded += n(r.goals_conceded);
    s.saves += n(r.saves);
    s.bonus += n(r.bonus);
    s.bps += n(r.bps);
    s.starts += n(r.starts);
    s.defensive_contribution += n(r.defensive_contribution);
    s.expected_goals += n(r.expected_goals);
    s.expected_assists += n(r.expected_assists);
    s.expected_goals_conceded += n(r.expected_goals_conceded);
    s.yellow_cards = (s.yellow_cards ?? 0) + n(r.yellow_cards);
    s.total_points += n(r.total_points);
    cur.explain.push({ fixture: n(r.fixture) });
    acc.set(key, cur);
  }
  // The dataset has gaps where xP wasn't captured (all zeros); drop those GWs from the benchmark.
  for (const [gw, m] of fplXp) if (![...m.values()].some((v) => v !== 0)) fplXp.delete(gw);
  for (const [key, el] of acc) {
    const gw = Number(key.split(":")[0]);
    if (!lives.has(gw)) lives.set(gw, { elements: [] });
    lives.get(gw)!.elements.push(el);
  }

  const events = Array.from({ length: 38 }, (_, i) => {
    const gw = i + 1;
    const kos = fixtures.filter((f) => f.event === gw && f.kickoff_time).map((f) => f.kickoff_time!).sort();
    const first = kos[0] ? new Date(new Date(kos[0]).getTime() - 90 * 60_000).toISOString() : new Date(0).toISOString();
    return { id: gw, name: `Gameweek ${gw}`, deadline_time: first, finished: true, data_checked: true, is_previous: false, is_current: false, is_next: false, average_entry_score: null };
  });

  const baseElements = players.map((p) => ({
    id: n(p.id),
    code: n(p.code),
    web_name: p.web_name,
    first_name: p.first_name,
    second_name: p.second_name,
    element_type: n(p.element_type),
    team: n(p.team),
    now_cost: n(p.now_cost),
  }));

  const bootstrapAt = (gw: number): Bootstrap => {
    const elements: Element[] = baseElements.map((b) => {
      // Latest known team/price at or before gw (fall back to the first appearance after).
      const st = state.get(b.id);
      let team = b.team;
      let price = b.now_cost;
      if (st) {
        const known = [...st.keys()].sort((a, c) => a - c);
        const prior = known.filter((g) => g <= gw).pop() ?? known[0];
        team = st.get(prior)!.team || team;
        price = st.get(prior)!.value || price;
      }
      return {
        ...b,
        team,
        now_cost: price,
        cost_change_start: 0,
        cost_change_event: 0,
        status: "a",
        news: "",
        chance_of_playing_next_round: null,
        chance_of_playing_this_round: null,
        selected_by_percent: 0,
        form: 0,
        points_per_game: 0,
        total_points: 0,
        event_points: 0,
        minutes: 0,
        starts: 0,
        goals_scored: 0,
        assists: 0,
        clean_sheets: 0,
        goals_conceded: 0,
        saves: 0,
        bonus: 0,
        bps: 0,
        yellow_cards: 0,
        red_cards: 0,
        expected_goals: 0,
        expected_assists: 0,
        expected_goal_involvements: 0,
        expected_goals_conceded: 0,
        defensive_contribution: 0,
        ict_index: 0,
        ep_next: null,
        ep_this: null,
        transfers_in_event: 0,
        transfers_out_event: 0,
        penalties_order: null,
        direct_freekicks_order: null,
        corners_and_indirect_freekicks_order: null,
      };
    });
    return {
      elements,
      teams: teams.map((t, i) => ({
        id: n(t.id),
        code: n(t.code),
        name: t.name,
        short_name: t.short_name,
        strength_overall_home: scale(strengths[i]),
        strength_overall_away: scale(strengths[i]),
      })),
      events,
      chips: [],
      element_types: [],
      game_settings: { squad_total_spend: 1000, squad_team_limit: 3, max_extra_free_transfers: 4, transfers_sell_on_fee: 0.5 },
      game_config: { scoring },
      total_players: 0,
    };
  };

  const priors = new Map<number, PlayerPrior>();
  if (priorDir) {
    for (const p of parseCsv(`${priorDir}/players_raw.csv`)) {
      priors.set(n(p.code), {
        minutes: n(p.minutes),
        starts: n(p.starts),
        xg: n(p.expected_goals),
        xa: n(p.expected_assists),
        goals: n(p.goals_scored),
        assists: n(p.assists),
        bonus: n(p.bonus),
        saves: n(p.saves),
        dc: p.defensive_contribution === undefined ? null : n(p.defensive_contribution),
        yellow: n(p.yellow_cards),
      });
    }
  }
  return { bootstrapAt, fixtures, lives, priors, fplXp };
}
