import { kv } from "@/lib/store";
import type { PlayerRow } from "@/lib/data/view";
import type { Bootstrap, Fixture } from "@/lib/fpl/schemas";
import { COMPETITIONS } from "./espn";
import { KEYS, type ExtIndex, type ExtMatches } from "./ingest";

export interface ExternalAdjustments {
  minutesMultipliers?: Map<string, number>;
  attackAdjust?: Map<number, number>;
  info?: Map<number, PlayerRow["ext"]>;
}

const DAY = 86400_000;
const EUROPE = new Set<string>(COMPETITIONS.filter((c) => c.europe).map((c) => c.slug));
const LABEL = Object.fromEntries(COMPETITIONS.map((c) => [c.slug, c.label]));

/** Tunables, kept modest because there is little data to calibrate them on yet. */
export const CONGESTION = {
  europeBefore: 0.05, // P(start) cut when a European match is <= 4 days before the PL game
  cupBefore: 0.03, // domestic cup match <= 4 days before
  europeAfter: 0.02, // big European match <= 3 days after (managers rest players ahead of it)
  floor: 0.88,
};
/**
 * All-comps form. ESPN has no xG, so non-PL output is proxied by shots (~0.11 xG each) plus
 * assists. Cup ties vs lower-league sides count less. The PL side gets ~10 matches of
 * pseudo-data so a couple of quiet cup games can't swing a projection much.
 */
export const FORM = { xgPerShot: 0.11, assistWeight: 0.8, cupDiscount: 0.7, priorMinutes: 900, priorFloor: 1.5, minXgi90: 0.15, cap: 0.1 };

/**
 * P(start) multipliers per `${fplTeam}:${fixtureId}` from fixture congestion.
 * Pure: exported for tests.
 */
export function congestionMultipliers(index: ExtIndex, fixtures: Fixture[], gws: Set<number>): Map<string, number> {
  const byTeam = new Map<number, ExtIndex["fixtures"]>();
  for (const f of index.fixtures) byTeam.set(f.fplTeam, [...(byTeam.get(f.fplTeam) ?? []), f]);
  const out = new Map<string, number>();
  for (const f of fixtures) {
    if (f.event == null || !gws.has(f.event) || !f.kickoff_time) continue;
    const ko = new Date(f.kickoff_time).getTime();
    for (const team of [f.team_h, f.team_a]) {
      let cut = 0;
      for (const x of byTeam.get(team) ?? []) {
        const t = new Date(x.date).getTime();
        const before = (ko - t) / DAY;
        const after = (t - ko) / DAY;
        if (before > 0 && before <= 4) cut += EUROPE.has(x.comp) ? CONGESTION.europeBefore : CONGESTION.cupBefore;
        else if (after > 0 && after <= 3 && EUROPE.has(x.comp)) cut += CONGESTION.europeAfter;
      }
      if (cut > 0) out.set(`${team}:${f.id}`, Math.max(CONGESTION.floor, 1 - cut));
    }
  }
  return out;
}

/** Multiplier on a player's attacking rates: non-PL attacking output vs what their PL xGI rate predicts. */
export function formAdjustment(plXgi: number, plMinutes: number, extProxy: number, extMinutes: number): number {
  if (extMinutes < 90 || plMinutes < 180 || plXgi <= 0) return 1;
  const rate = plXgi / plMinutes; // xGI per minute
  if (rate * 90 < FORM.minXgi90) return 1; // only meaningful for players with an attacking role
  const prior = Math.max(rate * FORM.priorMinutes, FORM.priorFloor);
  const adj = (plXgi + prior + extProxy) / (plXgi + prior + rate * extMinutes);
  return Math.min(1 + FORM.cap, Math.max(1 - FORM.cap, adj));
}

export function buildAdjustments(
  bootstrap: Bootstrap,
  fixtures: Fixture[],
  index: ExtIndex | null,
  store: ExtMatches | null,
  now = new Date(),
): ExternalAdjustments {
  if (!index && !store) return {};
  const nextGw = bootstrap.events.find((e) => e.is_next)?.id ?? 1;
  const gws = new Set(Array.from({ length: 6 }, (_, i) => nextGw + i));
  const minutesMultipliers = index ? congestionMultipliers(index, fixtures, gws) : new Map<string, number>();

  // Aggregate non-PL appearances per FPL player.
  type Agg = { apps: number; mins: number; mins14: number; proxy: number; goals: number; assists: number; byComp: Map<string, number> };
  const agg = new Map<number, Agg>();
  for (const m of Object.values(store?.matches ?? {})) {
    const recent = now.getTime() - new Date(m.date).getTime() <= 14 * DAY;
    const quality = EUROPE.has(m.comp) ? 1 : FORM.cupDiscount;
    for (const [id, , , mins, g, a, shots] of m.rows) {
      const x = agg.get(id) ?? { apps: 0, mins: 0, mins14: 0, proxy: 0, goals: 0, assists: 0, byComp: new Map() };
      x.apps++;
      x.mins += mins;
      if (recent) x.mins14 += mins;
      x.proxy += quality * (FORM.xgPerShot * shots + FORM.assistWeight * a);
      x.goals += g;
      x.assists += a;
      x.byComp.set(m.comp, (x.byComp.get(m.comp) ?? 0) + 1);
      agg.set(id, x);
    }
  }

  const attackAdjust = new Map<number, number>();
  const info = new Map<number, NonNullable<PlayerRow["ext"]>>();
  const firstFixture = new Map<number, number>();
  for (const f of [...fixtures].filter((f) => f.event === nextGw)) {
    if (!firstFixture.has(f.team_h)) firstFixture.set(f.team_h, f.id);
    if (!firstFixture.has(f.team_a)) firstFixture.set(f.team_a, f.id);
  }
  for (const e of bootstrap.elements) {
    const x = agg.get(e.id);
    const fx = firstFixture.get(e.team);
    const mm = fx !== undefined ? (minutesMultipliers.get(`${e.team}:${fx}`) ?? 1) : 1;
    if (!x && mm === 1) continue;
    const attacker = e.element_type === 3 || e.element_type === 4;
    const adj = x && attacker ? formAdjustment(e.expected_goal_involvements, e.minutes, x.proxy, x.mins) : 1;
    if (adj !== 1) attackAdjust.set(e.id, adj);
    const comps = x ? [...x.byComp.entries()].map(([c, n]) => `${LABEL[c]} ${n}`).join(", ") : "";
    info.set(e.id, {
      comps: x?.apps ?? 0,
      mins14d: x?.mins14 ?? 0,
      minutesFactor: Math.round(mm * 100) / 100,
      form90: x && x.mins > 0 ? Math.round((((x.goals + x.assists) / x.mins) * 90) * 100) / 100 : null,
      label: x ? `${comps}: ${x.goals}G ${x.assists}A in ${x.mins}′${adj !== 1 ? ` (attack ×${adj.toFixed(2)})` : ""}` : null,
    });
  }
  return { minutesMultipliers, attackAdjust, info };
}

// Called inside the cached getAppData(), so no cache directive of its own.
async function readStored() {
  const [index, store] = await Promise.all([
    kv().get<ExtIndex>(KEYS.index).catch(() => null),
    kv().get<ExtMatches>(KEYS.matches).catch(() => null),
  ]);
  return { index, store };
}

/** Loads stored other-competition data (written by the daily ingest). Empty if none yet. */
export async function loadExternal(bootstrap?: Bootstrap, fixtures?: Fixture[]): Promise<ExternalAdjustments> {
  if (!bootstrap || !fixtures) return {};
  const { index, store } = await readStored();
  return buildAdjustments(bootstrap, fixtures, index, store);
}
