"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import type { PlayerRow } from "@/lib/data/view";
import { findDifferentials, findTraps, type DiffTag } from "@/lib/model/differentials";
import { Card, FixtureChip, PosBadge, StatusDot, fmt } from "./ui";

const TAG_STYLE: Record<DiffTag, string> = {
  underlying: "Underlying",
  "model-vs-market": "Model > market",
  rising: "Rising",
  fixtures: "Fixtures",
  "minutes-up": "Minutes up",
};

export function DifferentialsView({
  players,
  gws,
  ownDelta,
  trendWindow,
}: {
  players: PlayerRow[];
  gws: number[];
  ownDelta: Record<number, number> | null;
  trendWindow: string | null;
}) {
  const [maxOwn, setMaxOwn] = useState(10);
  const [pos, setPos] = useState("ALL");
  const [onlyTagged, setOnlyTagged] = useState(true);
  const diffs = useMemo(
    () =>
      findDifferentials(players, {
        maxOwnership: maxOwn,
        ownDelta: ownDelta ? new Map(Object.entries(ownDelta).map(([k, v]) => [Number(k), v])) : null,
      }).filter((d) => (pos === "ALL" || d.player.pos === pos) && (!onlyTagged || d.tags.length > 0)),
    [players, maxOwn, ownDelta, pos, onlyTagged],
  );
  const traps = useMemo(() => findTraps(players), [players]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface p-3 text-sm">
        <label className="flex items-center gap-2">
          <span className="text-muted">Owned by under</span>
          <input type="range" min={1} max={20} value={maxOwn} onChange={(e) => setMaxOwn(Number(e.target.value))} className="w-28 accent-[var(--accent)]" />
          <span className="w-10 tabular font-medium">{maxOwn}%</span>
        </label>
        <div className="flex overflow-hidden rounded-lg border border-border">
          {["ALL", "GKP", "DEF", "MID", "FWD"].map((p) => (
            <button key={p} onClick={() => setPos(p)} className={`px-3 py-1.5 ${pos === p ? "bg-accent text-accent-text" : "hover:bg-surface-2"}`}>
              {p === "ALL" ? "All" : p}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={onlyTagged} onChange={(e) => setOnlyTagged(e.target.checked)} className="accent-[var(--accent)]" />
          Only with a reason
        </label>
        <span className="ml-auto text-xs text-muted">
          {trendWindow ? `Ownership trend: ${trendWindow}` : "Ownership trends appear after a few daily snapshots"}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {diffs.slice(0, 24).map(({ player: p, edge, tags, ownDelta: dlt }) => (
          <div key={p.id} className="flex flex-col rounded-xl border border-border bg-surface p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <Link href={`/players?focus=${p.id}`} className="truncate font-semibold hover:underline">{p.name}</Link>
                  <StatusDot status={p.status} chance={p.chance} news={p.news} />
                  <PosBadge pos={p.pos} />
                </div>
                <div className="text-xs text-muted">
                  {p.teamShort} · {fmt.price(p.price)} · {fmt.pct(p.ownership)} owned
                  {dlt !== null && dlt !== 0 && <span className={dlt > 0 ? "text-good" : "text-bad"}> ({dlt > 0 ? "+" : ""}{dlt.toFixed(1)})</span>}
                </div>
              </div>
              <div className="text-right">
                <div className="tabular text-lg font-semibold text-accent">{edge.toFixed(1)}</div>
                <div className="text-[10px] uppercase tracking-wide text-muted">edge</div>
              </div>
            </div>
            <div className="mt-3 flex gap-1">{p.fixtures.slice(0, gws.length).map((f, i) => <FixtureChip key={i} f={f} compact />)}</div>
            <div className="mt-3 grid grid-cols-4 gap-2 text-center text-xs">
              <Mini k="xPts" v={p.xpts.toFixed(1)} />
              <Mini k="Next" v={p.next.toFixed(1)} />
              <Mini k="xGI/90" v={p.season.xgi90.toFixed(2)} />
              <Mini k="Haul" v={`${Math.round(p.pHaul * 100)}%`} />
            </div>
            {tags.length > 0 && (
              <ul className="mt-3 space-y-1 text-xs">
                {tags.map((t) => (
                  <li key={t.tag} className="flex gap-2">
                    <span className="shrink-0 rounded bg-accent-soft px-1.5 py-0.5 font-medium text-accent">{TAG_STYLE[t.tag]}</span>
                    <span className="text-muted">{t.label}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
      {diffs.length === 0 && <p className="text-sm text-muted">No differentials under {maxOwn}% with these filters.</p>}

      <Card title="Popular but projected to underperform" subtitle="Owned by 15%+ while a similarly priced option in the same position projects 3+ more points">
        {traps.length ? (
          <ul className="divide-y divide-border">
            {traps.map((p) => (
              <li key={p.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{p.name}</span> <span className="text-muted">{p.teamShort} · {p.pos} · {fmt.price(p.price)}</span>
                </span>
                <span className="tabular text-muted">{fmt.pct(p.ownership)} owned</span>
                <span className="w-20 text-right tabular font-medium">{p.xpts.toFixed(1)} xPts</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No obvious traps right now.</p>
        )}
      </Card>
    </div>
  );
}

function Mini({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded bg-surface-2 px-1 py-1">
      <div className="tabular font-medium">{v}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted">{k}</div>
    </div>
  );
}
