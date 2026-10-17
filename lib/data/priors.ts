import { z } from "zod";
import { kv } from "@/lib/store";
import type { Bootstrap } from "@/lib/fpl/schemas";
import type { PlayerPrior } from "@/lib/model/types";

const num = z.coerce.number();
const HistoryPastSchema = z.object({
  history_past: z.array(
    z.object({
      season_name: z.string(),
      element_code: z.number(),
      minutes: z.number(),
      starts: z.number(),
      goals_scored: z.number(),
      assists: z.number(),
      bonus: z.number(),
      saves: z.number(),
      yellow_cards: z.number(),
      defensive_contribution: z.number(),
      expected_goals: num,
      expected_assists: num,
    }),
  ),
});

/** Season whose totals serve as priors: the season before the one the bootstrap describes. */
export function priorSeasonName(bootstrap: Bootstrap): string {
  const first = new Date(bootstrap.events[0]?.deadline_time ?? Date.now());
  const y = first.getUTCFullYear();
  return `${y - 1}/${String(y).slice(2)}`;
}

type PriorStore = { season: string; byCode: Record<number, PlayerPrior | null> };

export async function loadPriors(bootstrap: Bootstrap): Promise<Map<number, PlayerPrior>> {
  const season = priorSeasonName(bootstrap);
  const stored = await kv().get<PriorStore>(`priors:${season}`);
  const m = new Map<number, PlayerPrior>();
  for (const [code, p] of Object.entries(stored?.byCode ?? {})) if (p) m.set(Number(code), p);
  return m;
}

/**
 * Fetches last-season totals (element-summary history_past) for players not yet stored.
 * Resumable: processes at most `budget` players per call so it fits in a serverless timeout.
 */
export async function ingestPriors(bootstrap: Bootstrap, budget = 200, concurrency = 6) {
  const season = priorSeasonName(bootstrap);
  const key = `priors:${season}`;
  const store: PriorStore = (await kv().get<PriorStore>(key)) ?? { season, byCode: {} };
  const todo = bootstrap.elements.filter((e) => !(e.code in store.byCode)).slice(0, budget);
  let failed = 0;
  let i = 0;
  async function worker() {
    while (i < todo.length) {
      const el = todo[i++];
      try {
        const res = await fetch(`https://fantasy.premierleague.com/api/element-summary/${el.id}/`, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; fpl-predictor/2.0)" },
          cache: "no-store",
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) throw new Error(String(res.status));
        const past = HistoryPastSchema.parse(await res.json()).history_past.find((h) => h.season_name === season);
        store.byCode[el.code] = past
          ? {
              minutes: past.minutes,
              starts: past.starts,
              xg: past.expected_goals,
              xa: past.expected_assists,
              goals: past.goals_scored,
              assists: past.assists,
              bonus: past.bonus,
              saves: past.saves,
              dc: past.defensive_contribution,
              yellow: past.yellow_cards,
            }
          : null;
      } catch {
        failed++;
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  await kv().set(key, store);
  const remaining = bootstrap.elements.filter((e) => !(e.code in store.byCode)).length;
  return { season, processed: todo.length - failed, failed, remaining };
}
