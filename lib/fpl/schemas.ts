import { z } from "zod";

// FPL serialises many decimals as strings ("5.2"); coerce them to numbers.
const num = z.coerce.number();
const nullableNum = z.number().nullable();

export const ElementSchema = z.object({
  id: z.number(),
  code: z.number(),
  web_name: z.string(),
  first_name: z.string(),
  second_name: z.string(),
  team: z.number(),
  element_type: z.number(),
  now_cost: z.number(),
  cost_change_start: z.number(),
  cost_change_event: z.number(),
  status: z.string(),
  news: z.string(),
  chance_of_playing_next_round: nullableNum,
  chance_of_playing_this_round: nullableNum,
  selected_by_percent: num,
  form: num,
  points_per_game: num,
  total_points: z.number(),
  event_points: z.number(),
  minutes: z.number(),
  starts: z.number(),
  goals_scored: z.number(),
  assists: z.number(),
  clean_sheets: z.number(),
  goals_conceded: z.number(),
  saves: z.number(),
  bonus: z.number(),
  bps: z.number(),
  yellow_cards: z.number(),
  red_cards: z.number(),
  expected_goals: num,
  expected_assists: num,
  expected_goal_involvements: num,
  expected_goals_conceded: num,
  defensive_contribution: z.number(),
  ict_index: num,
  ep_next: num.nullable(),
  ep_this: num.nullable(),
  transfers_in_event: z.number(),
  transfers_out_event: z.number(),
  penalties_order: nullableNum,
  direct_freekicks_order: nullableNum,
  corners_and_indirect_freekicks_order: nullableNum,
  birth_date: z.string().nullable().optional(),
  price_change_percent: num.nullable().optional(),
  price_change_projections: z
    .array(z.object({ offset: z.number(), projected_percent: num, likelihood: z.number() }))
    .nullable()
    .optional(),
  can_select: z.boolean().optional(),
  removed: z.boolean().optional(),
  photo: z.string().optional(),
});
export type Element = z.infer<typeof ElementSchema>;

export const TeamSchema = z.object({
  id: z.number(),
  code: z.number(),
  name: z.string(),
  short_name: z.string(),
  strength_overall_home: z.number().nullable(),
  strength_overall_away: z.number().nullable(),
});
export type Team = z.infer<typeof TeamSchema>;

export const EventSchema = z.object({
  id: z.number(),
  name: z.string(),
  deadline_time: z.string(),
  finished: z.boolean(),
  data_checked: z.boolean(),
  is_previous: z.boolean(),
  is_current: z.boolean(),
  is_next: z.boolean(),
  average_entry_score: z.number().nullable(),
});
export type Event = z.infer<typeof EventSchema>;

export const ChipSchema = z.object({
  id: z.number(),
  name: z.string(),
  start_event: z.number(),
  stop_event: z.number(),
  chip_type: z.string(),
});
export type Chip = z.infer<typeof ChipSchema>;

const byPos = z.object({ GKP: z.number(), DEF: z.number(), MID: z.number(), FWD: z.number() });
export const ScoringSchema = z.object({
  long_play: z.number(),
  short_play: z.number(),
  goals_conceded: byPos,
  saves: z.number(),
  goals_scored: byPos,
  assists: z.number(),
  clean_sheets: byPos,
  yellow_cards: z.number(),
  red_cards: z.number(),
  bonus: z.number(),
  defensive_contribution: byPos,
});
export type Scoring = z.infer<typeof ScoringSchema>;

export const BootstrapSchema = z.object({
  elements: z.array(ElementSchema),
  teams: z.array(TeamSchema),
  events: z.array(EventSchema),
  chips: z.array(ChipSchema),
  element_types: z.array(
    z.object({ id: z.number(), singular_name_short: z.string(), squad_select: z.number(), squad_min_play: z.number(), squad_max_play: z.number() }),
  ),
  game_settings: z.object({
    squad_total_spend: z.number(),
    squad_team_limit: z.number(),
    max_extra_free_transfers: z.number(),
    transfers_sell_on_fee: z.number(),
  }),
  game_config: z.object({ scoring: ScoringSchema }),
  total_players: z.number(),
});
export type Bootstrap = z.infer<typeof BootstrapSchema>;

export const FixtureSchema = z.object({
  id: z.number(),
  event: z.number().nullable(),
  team_h: z.number(),
  team_a: z.number(),
  team_h_score: nullableNum,
  team_a_score: nullableNum,
  team_h_difficulty: z.number(),
  team_a_difficulty: z.number(),
  kickoff_time: z.string().nullable(),
  started: z.boolean().nullable(),
  finished: z.boolean(),
  finished_provisional: z.boolean(),
});
export type Fixture = z.infer<typeof FixtureSchema>;
export const FixturesSchema = z.array(FixtureSchema);

export const LiveStatsSchema = z.object({
  minutes: z.number(),
  goals_scored: z.number(),
  assists: z.number(),
  clean_sheets: z.number(),
  goals_conceded: z.number(),
  saves: z.number(),
  bonus: z.number(),
  bps: z.number(),
  starts: z.number(),
  defensive_contribution: z.number(),
  expected_goals: num,
  expected_assists: num,
  expected_goals_conceded: num,
  yellow_cards: z.number().optional(),
  total_points: z.number(),
});
export const LiveSchema = z.object({
  elements: z.array(
    z.object({
      id: z.number(),
      stats: LiveStatsSchema,
      explain: z.array(z.object({ fixture: z.number() })),
    }),
  ),
});
export type Live = z.infer<typeof LiveSchema>;
export type LiveStats = z.infer<typeof LiveStatsSchema>;

export const PicksSchema = z.object({
  active_chip: z.string().nullable(),
  entry_history: z.object({
    event: z.number(),
    points: z.number(),
    total_points: z.number(),
    overall_rank: z.number().nullable(),
    bank: z.number(),
    value: z.number(),
    event_transfers: z.number(),
    event_transfers_cost: z.number(),
  }),
  picks: z.array(
    z.object({
      element: z.number(),
      position: z.number(),
      multiplier: z.number(),
      is_captain: z.boolean(),
      is_vice_captain: z.boolean(),
      element_type: z.number().optional(),
    }),
  ),
});
export type Picks = z.infer<typeof PicksSchema>;

export const EntryHistorySchema = z.object({
  current: z.array(
    z.object({
      event: z.number(),
      points: z.number(),
      total_points: z.number(),
      overall_rank: z.number().nullable(),
      bank: z.number(),
      value: z.number(),
      event_transfers: z.number(),
      event_transfers_cost: z.number(),
      points_on_bench: z.number(),
    }),
  ),
  chips: z.array(z.object({ name: z.string(), event: z.number(), time: z.string() })),
});
export type EntryHistory = z.infer<typeof EntryHistorySchema>;

export const TransfersSchema = z.array(
  z.object({
    element_in: z.number(),
    element_in_cost: z.number(),
    element_out: z.number(),
    element_out_cost: z.number(),
    event: z.number(),
    time: z.string(),
  }),
);
export type Transfers = z.infer<typeof TransfersSchema>;

export const EntrySchema = z.object({
  id: z.number(),
  name: z.string(),
  player_first_name: z.string(),
  player_last_name: z.string(),
  current_event: z.number().nullable(),
  summary_overall_points: z.number().nullable(),
  summary_overall_rank: z.number().nullable(),
  last_deadline_bank: z.number().nullable(),
  last_deadline_value: z.number().nullable(),
});
export type Entry = z.infer<typeof EntrySchema>;
