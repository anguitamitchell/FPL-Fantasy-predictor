import type { PlayerRow } from "@/lib/data/view";

export type DiffTag = "underlying" | "model-vs-market" | "rising" | "fixtures" | "minutes-up";

export interface Differential {
  player: PlayerRow;
  edge: number; // expected points gained on the field: xPts x (1 - ownership)
  tags: { tag: DiffTag; label: string }[];
  ownDelta: number | null;
}

/**
 * Low-owned players the model rates highly, each tagged with *why* they look undervalued.
 * `ownDelta` is the ownership change (pp) over the last few days when snapshots exist.
 */
export function findDifferentials(
  players: PlayerRow[],
  opts: { maxOwnership: number; ownDelta?: Map<number, number> | null; minPlay?: number },
): Differential[] {
  const minPlay = opts.minPlay ?? 0.6;
  const pool = players.filter((p) => p.pPlay >= minPlay);
  // Position-relative ranks: xPts rank vs ownership rank
  const byPos = new Map<string, PlayerRow[]>();
  for (const p of pool) byPos.set(p.pos, [...(byPos.get(p.pos) ?? []), p]);
  const xRank = new Map<number, number>();
  const oRank = new Map<number, number>();
  for (const list of byPos.values()) {
    [...list].sort((a, b) => b.xpts - a.xpts).forEach((p, i) => xRank.set(p.id, i + 1));
    [...list].sort((a, b) => b.ownership - a.ownership).forEach((p, i) => oRank.set(p.id, i + 1));
  }

  const maxStarts = Math.max(1, ...players.map((p) => p.season.starts));
  const out: Differential[] = [];
  for (const p of pool) {
    if (p.ownership > opts.maxOwnership) continue;
    const tags: Differential["tags"] = [];
    const xgi = p.season.xg + p.season.xa;
    const gi = p.season.goals + p.season.assists;
    if (xgi >= 1.5 && gi <= xgi * 0.7) {
      tags.push({ tag: "underlying", label: `${(xgi - gi).toFixed(1)} xGI unconverted: due a return` });
    }
    const xr = xRank.get(p.id)!;
    const or = oRank.get(p.id)!;
    if (xr <= 20 && or - xr >= 15) {
      tags.push({ tag: "model-vs-market", label: `#${xr} ${p.pos} by xPts but #${or} by ownership` });
    }
    const delta = opts.ownDelta?.get(p.id) ?? null;
    if ((delta !== null && delta >= 0.3) || (p.priceTrend && p.priceTrend.percent >= 50 && p.netTransfersGw > 0)) {
      tags.push({
        tag: "rising",
        label: delta !== null && delta >= 0.3 ? `Ownership +${delta.toFixed(1)}pp in days: get in early` : "Transfers in: price rise building",
      });
    }
    const run = p.fixtures.slice(0, 3).reduce((s, f) => s + f.ease, 0);
    if (run >= 1.2) tags.push({ tag: "fixtures", label: `Kind next 3: ${p.fixtures.slice(0, 3).map((f) => f.opp).join(", ")}` });
    if (p.pPlay >= 0.85 && p.season.starts <= maxStarts * 0.5) {
      tags.push({ tag: "minutes-up", label: `Only ${p.season.starts} starts so far but now projected to start: totals understate them` });
    }
    out.push({ player: p, edge: p.xpts * (1 - p.ownership / 100), tags, ownDelta: delta });
  }
  return out.sort((a, b) => b.edge - a.edge);
}

/** Popular players the model rates poorly: candidates to sell or avoid. */
export function findTraps(players: PlayerRow[], minOwnership = 15): PlayerRow[] {
  const pool = players.filter((p) => p.ownership >= minOwnership);
  return pool
    .map((p) => {
      const peers = players.filter((q) => q.pos === p.pos && Math.abs(q.price - p.price) <= 0.6 && q.pPlay >= 0.6);
      const best = Math.max(...peers.map((q) => q.xpts));
      return { p, gap: best - p.xpts };
    })
    .filter((x) => x.gap >= 3)
    .sort((a, b) => b.p.ownership * b.gap - a.p.ownership * a.gap)
    .map((x) => x.p)
    .slice(0, 8);
}
