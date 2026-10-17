import { kv } from "@/lib/store";
import type { Bootstrap } from "@/lib/fpl/schemas";
import { COMPETITIONS, matchSummary, premierLeagueTeams, teamSchedule, type CompSlug, type ExtFixture } from "./espn";
import { mapTeams, matchPlayer } from "./mapping";

/** Every non-PL fixture for PL clubs (completed and upcoming). */
export interface ExtIndex {
  updatedAt: string;
  fixtures: (ExtFixture & { fplTeam: number })[];
}

/** Compact per-match player rows: [fplId, fplTeam, starter, minutes, goals, assists, shots, shotsOnTarget]. */
export type ExtRow = [number, number, 0 | 1, number, number, number, number, number];
export interface ExtMatches {
  matches: Record<string, { comp: CompSlug; date: string; rows: ExtRow[]; unmapped: string[] }>;
}

export const KEYS = { index: "ext:index", matches: "ext:matches", overrides: "ext:overrides" } as const;

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

/**
 * Pulls UCL/UEL/UECL/FA Cup/EFL Cup schedules for all 20 clubs from ESPN and the box
 * scores of newly completed matches. Already-stored matches are never re-fetched.
 */
export async function ingestExternal(b: Bootstrap, summaryBudget = 40) {
  if (process.env.EXTERNAL_DATA === "off") return { skipped: "EXTERNAL_DATA=off" };
  const espnTeams = await premierLeagueTeams();
  const teamMap = mapTeams(espnTeams, b.teams);

  // ESPN's default schedule can include last season's cup ties; keep this season only.
  const seasonStart = new Date(new Date(b.events[0].deadline_time).getTime() - 45 * 86400_000).toISOString();

  const jobs = [...teamMap.keys()].flatMap((espnTeam) => COMPETITIONS.map((c) => ({ espnTeam, comp: c.slug })));
  const fixtures: ExtIndex["fixtures"] = [];
  let failures = 0;
  await pool(jobs, 6, async ({ espnTeam, comp }) => {
    try {
      for (const f of await teamSchedule(comp, espnTeam)) {
        if (f.date >= seasonStart) fixtures.push({ ...f, fplTeam: teamMap.get(espnTeam)! });
      }
    } catch {
      failures++;
    }
  });
  // Keep the previous index if ESPN was mostly unreachable.
  if (failures > jobs.length / 2) throw new Error(`ESPN schedules failed for ${failures}/${jobs.length} requests`);
  await kv().set(KEYS.index, { updatedAt: new Date().toISOString(), fixtures } satisfies ExtIndex);

  const store = (await kv().get<ExtMatches>(KEYS.matches)) ?? { matches: {} };
  for (const [id, m] of Object.entries(store.matches)) if (m.date < seasonStart) delete store.matches[id];
  const overrides = (await kv().get<Record<string, number>>(KEYS.overrides)) ?? {};
  const todo = new Map<string, { comp: CompSlug; date: string }>();
  for (const f of fixtures) if (f.completed && !store.matches[f.eventId]) todo.set(f.eventId, { comp: f.comp, date: f.date });

  const byTeam = new Map<number, typeof b.elements>();
  for (const e of b.elements) byTeam.set(e.team, [...(byTeam.get(e.team) ?? []), e]);

  let fetched = 0;
  await pool([...todo.entries()].slice(0, summaryBudget), 4, async ([eventId, m]) => {
    try {
      const match = await matchSummary(m.comp, eventId, m.date);
      const rows: ExtRow[] = [];
      const unmapped: string[] = [];
      for (const p of match.players) {
        const fplTeam = teamMap.get(p.espnTeam);
        if (fplTeam === undefined || p.minutes <= 0) continue; // only PL clubs' players who played
        const fplId = overrides[p.espnId] ?? matchPlayer(p.name, byTeam.get(fplTeam) ?? []);
        if (fplId == null) {
          unmapped.push(`${p.name} (${p.team})`);
          continue;
        }
        rows.push([fplId, fplTeam, p.starter ? 1 : 0, p.minutes, p.goals, p.assists, p.shots, p.shotsOnTarget]);
      }
      store.matches[eventId] = { comp: m.comp, date: m.date, rows, unmapped };
      fetched++;
    } catch {
      // try again next run
    }
  });
  await kv().set(KEYS.matches, store);

  const all = Object.values(store.matches);
  const mapped = all.reduce((s, m) => s + m.rows.length, 0);
  const unmapped = all.reduce((s, m) => s + m.unmapped.length, 0);
  return {
    fixtures: fixtures.length,
    upcoming: fixtures.filter((f) => !f.completed).length,
    matchesStored: all.length,
    fetchedNow: fetched,
    pendingSummaries: Math.max(0, todo.size - fetched),
    playerMappingCoverage: mapped + unmapped > 0 ? Math.round((1000 * mapped) / (mapped + unmapped)) / 10 : null,
    unmappedSample: all.flatMap((m) => m.unmapped).slice(0, 15),
  };
}
