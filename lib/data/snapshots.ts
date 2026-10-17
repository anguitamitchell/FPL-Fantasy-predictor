import { kv } from "@/lib/store";
import type { Bootstrap } from "@/lib/fpl/schemas";

/** Compact daily snapshot: id -> [price, ownership%, net transfers this GW, form]. */
export type Snapshot = { date: string; gw: number | null; players: Record<number, [number, number, number, number]> };

export const today = (d = new Date()) => d.toISOString().slice(0, 10);

export async function writeSnapshot(b: Bootstrap, date = today()): Promise<Snapshot> {
  const snap: Snapshot = {
    date,
    gw: b.events.find((e) => e.is_current)?.id ?? null,
    players: Object.fromEntries(
      b.elements.map((e) => [e.id, [e.now_cost, e.selected_by_percent, e.transfers_in_event - e.transfers_out_event, e.form]]),
    ),
  };
  await kv().set(`snap:${date}`, snap);
  return snap;
}

/** Ownership change (percentage points) per player over the most recent `days` snapshots. */
export async function ownershipTrend(days = 3): Promise<{ from: string; to: string; delta: Map<number, number> } | null> {
  const keys = (await kv().list("snap:")).slice(-(days + 1));
  if (keys.length < 2) return null;
  const [first, last] = await Promise.all([kv().get<Snapshot>(keys[0]), kv().get<Snapshot>(keys[keys.length - 1])]);
  if (!first || !last) return null;
  const delta = new Map<number, number>();
  for (const [id, row] of Object.entries(last.players)) {
    const prev = first.players[Number(id)];
    if (prev) delta.set(Number(id), Math.round((row[1] - prev[1]) * 100) / 100);
  }
  return { from: first.date, to: last.date, delta };
}
