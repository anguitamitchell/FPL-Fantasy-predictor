import { z } from "zod";

/**
 * ESPN's public (keyless) soccer API. Unofficial, so every schema is permissive and the
 * rest of the app treats this data as optional.
 */
const BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer";

export const COMPETITIONS = [
  { slug: "uefa.champions", label: "UCL", europe: true },
  { slug: "uefa.europa", label: "UEL", europe: true },
  { slug: "uefa.europa.conf", label: "UECL", europe: true },
  { slug: "eng.fa", label: "FA Cup", europe: false },
  { slug: "eng.league_cup", label: "EFL Cup", europe: false },
] as const;
export type CompSlug = (typeof COMPETITIONS)[number]["slug"];

const Competitor = z.object({ team: z.object({ id: z.string(), displayName: z.string() }), homeAway: z.string() });
const ScheduleSchema = z.object({
  events: z
    .array(
      z.object({
        id: z.string(),
        date: z.string(),
        name: z.string(),
        competitions: z
          .array(
            z.object({
              competitors: z.array(Competitor),
              status: z.object({ type: z.object({ completed: z.boolean(), state: z.string().optional() }) }),
            }),
          )
          .min(1),
      }),
    )
    .default([]),
});

export interface ExtFixture {
  eventId: string;
  comp: CompSlug;
  date: string; // ISO kickoff
  completed: boolean;
  espnTeam: string;
  opponent: string;
  home: boolean;
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; fpl-predictor/2.0)", Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`ESPN ${res.status} for ${url}`);
  return res.json();
}

/** Completed + upcoming matches for one team in one competition. */
export async function teamSchedule(comp: CompSlug, espnTeam: string): Promise<ExtFixture[]> {
  const urls = [`${BASE}/${comp}/teams/${espnTeam}/schedule`, `${BASE}/${comp}/teams/${espnTeam}/schedule?fixture=true`];
  const out = new Map<string, ExtFixture>();
  for (const url of urls) {
    const parsed = ScheduleSchema.safeParse(await getJson(url));
    if (!parsed.success) continue;
    for (const e of parsed.data.events) {
      const c = e.competitions[0];
      const me = c.competitors.find((x) => x.team.id === espnTeam);
      const opp = c.competitors.find((x) => x.team.id !== espnTeam);
      if (!me || !opp) continue;
      out.set(e.id, {
        eventId: e.id,
        comp,
        date: e.date,
        completed: c.status.type.completed,
        espnTeam,
        opponent: opp.team.displayName,
        home: me.homeAway === "home",
      });
    }
  }
  return [...out.values()];
}

const SummarySchema = z.object({
  header: z.object({ competitions: z.array(z.object({ date: z.string() })).min(1) }).optional(),
  rosters: z
    .array(
      z.object({
        team: z.object({ id: z.string(), displayName: z.string() }),
        roster: z
          .array(
            z.object({
              starter: z.boolean().default(false),
              subbedIn: z.boolean().default(false),
              subbedOut: z.boolean().default(false),
              athlete: z.object({ id: z.string(), displayName: z.string() }),
              stats: z.array(z.object({ name: z.string(), value: z.number().nullable().optional() })).default([]),
            }),
          )
          .default([]),
      }),
    )
    .default([]),
  keyEvents: z
    .array(
      z.object({
        type: z.object({ type: z.string().optional(), text: z.string().optional() }).optional(),
        clock: z.object({ value: z.number().optional() }).optional(),
        period: z.object({ number: z.number().optional() }).optional(),
        participants: z.array(z.object({ athlete: z.object({ id: z.string() }) })).optional(),
      }),
    )
    .default([]),
});

export interface ExtPlayerMatch {
  espnId: string;
  name: string;
  espnTeam: string;
  team: string;
  starter: boolean;
  minutes: number;
  goals: number;
  assists: number;
  shots: number;
  shotsOnTarget: number;
}

export interface ExtMatch {
  eventId: string;
  comp: CompSlug;
  date: string;
  players: ExtPlayerMatch[];
}

/** Parses a match summary into per-player minutes and attacking returns. */
export function parseSummary(raw: unknown, comp: CompSlug, eventId: string, date: string): ExtMatch {
  const s = SummarySchema.parse(raw);
  const maxPeriod = Math.max(2, ...s.keyEvents.map((k) => k.period?.number ?? 0));
  const fullLength = maxPeriod > 2 ? 120 : 90;
  const subOn = new Map<string, number>();
  const subOff = new Map<string, number>();
  for (const k of s.keyEvents) {
    const kind = k.type?.type ?? k.type?.text?.toLowerCase();
    const minute = Math.min(fullLength, Math.round((k.clock?.value ?? 0) / 60));
    if (kind === "substitution" && k.participants && k.participants.length >= 2) {
      subOn.set(k.participants[0].athlete.id, minute);
      subOff.set(k.participants[1].athlete.id, minute);
    } else if ((kind === "red-card" || kind === "yellow-red-card") && k.participants?.[0]) {
      subOff.set(k.participants[0].athlete.id, minute);
    }
  }
  const players: ExtPlayerMatch[] = [];
  for (const side of s.rosters) {
    for (const p of side.roster) {
      const stat = (n: string) => p.stats.find((x) => x.name === n)?.value ?? 0;
      const id = p.athlete.id;
      let minutes = 0;
      if (p.starter) minutes = subOff.get(id) ?? fullLength;
      else if (p.subbedIn || stat("subIns") > 0) minutes = Math.max(1, (subOff.get(id) ?? fullLength) - (subOn.get(id) ?? fullLength - 15));
      players.push({
        espnId: id,
        name: p.athlete.displayName,
        espnTeam: side.team.id,
        team: side.team.displayName,
        starter: p.starter,
        minutes,
        goals: stat("totalGoals"),
        assists: stat("goalAssists"),
        shots: stat("totalShots"),
        shotsOnTarget: stat("shotsOnTarget"),
      });
    }
  }
  return { eventId, comp, date, players };
}

export async function matchSummary(comp: CompSlug, eventId: string, date: string): Promise<ExtMatch> {
  return parseSummary(await getJson(`${BASE}/${comp}/summary?event=${eventId}`), comp, eventId, date);
}

const TeamsSchema = z.object({
  sports: z.array(
    z.object({
      leagues: z.array(z.object({ teams: z.array(z.object({ team: z.object({ id: z.string(), displayName: z.string(), abbreviation: z.string() }) })) })),
    }),
  ),
});

/** ESPN's Premier League teams: id, name, abbreviation. */
export async function premierLeagueTeams() {
  const d = TeamsSchema.parse(await getJson(`${BASE}/eng.1/teams`));
  return d.sports[0].leagues[0].teams.map((t) => t.team);
}
