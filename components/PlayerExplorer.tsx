"use client";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { PlayerRow } from "@/lib/data/view";
import { FixtureChip, PosBadge, StatusDot, fmt } from "./ui";
import { PlayerBreakdown } from "./PlayerBreakdown";

type SortKey = "xpts" | "next" | "xptsPerM" | "form" | "ownership" | "price" | "pHaul" | "xgi90";
const SORTS: { key: SortKey; label: string }[] = [
  { key: "xpts", label: "xPts (horizon)" },
  { key: "next", label: "xPts next GW" },
  { key: "xptsPerM", label: "xPts per £m" },
  { key: "pHaul", label: "Haul chance" },
  { key: "xgi90", label: "xGI / 90" },
  { key: "form", label: "Form" },
  { key: "ownership", label: "Ownership" },
  { key: "price", label: "Price" },
];
const value = (p: PlayerRow, k: SortKey) => (k === "xgi90" ? p.season.xgi90 : p[k]);

export function PlayerExplorer({ players, gws, teams }: { players: PlayerRow[]; gws: number[]; teams: { id: number; short: string }[] }) {
  const params = useSearchParams();
  const focus = Number(params.get("focus")) || null;
  const [pos, setPos] = useState<string>("ALL");
  const [team, setTeam] = useState<number>(0);
  const [maxPrice, setMaxPrice] = useState<number>(16);
  const [maxOwn, setMaxOwn] = useState<number>(100);
  const [startersOnly, setStartersOnly] = useState(true);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("xpts");
  const [open, setOpen] = useState<number | null>(focus);
  const [limit, setLimit] = useState(60);

  useEffect(() => {
    if (!focus) return;
    document.getElementById(`p-${focus}`)?.scrollIntoView({ block: "center" });
  }, [focus]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return players
      .filter((p) => (focus && p.id === focus) || (
        !p.inactive &&
        (pos === "ALL" || p.pos === pos) &&
        (!team || p.team === team) &&
        p.price <= maxPrice &&
        p.ownership <= maxOwn &&
        (!startersOnly || p.pPlay >= 0.5) &&
        (!needle || p.name.toLowerCase().includes(needle) || p.fullName.toLowerCase().includes(needle))
      ))
      .sort((a, b) => value(b, sort) - value(a, sort));
  }, [players, pos, team, maxPrice, maxOwn, startersOnly, q, sort, focus]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-3 text-sm">
        <div className="flex overflow-hidden rounded-lg border border-border">
          {["ALL", "GKP", "DEF", "MID", "FWD"].map((p) => (
            <button key={p} onClick={() => setPos(p)} className={`px-3 py-1.5 ${pos === p ? "bg-accent text-accent-text" : "hover:bg-surface-2"}`}>
              {p === "ALL" ? "All" : p}
            </button>
          ))}
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search player" className="w-36 rounded-lg border border-border bg-bg px-2.5 py-1.5" />
        <select value={team} onChange={(e) => setTeam(Number(e.target.value))} className="rounded-lg border border-border bg-bg px-2 py-1.5">
          <option value={0}>All teams</option>
          {teams.map((t) => <option key={t.id} value={t.id}>{t.short}</option>)}
        </select>
        <label className="flex items-center gap-2">
          <span className="text-muted">Max £</span>
          <input type="range" min={4} max={16} step={0.5} value={maxPrice} onChange={(e) => setMaxPrice(Number(e.target.value))} className="w-24 accent-[var(--accent)]" />
          <span className="w-9 tabular">{maxPrice.toFixed(1)}</span>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-muted">Max own</span>
          <select value={maxOwn} onChange={(e) => setMaxOwn(Number(e.target.value))} className="rounded-lg border border-border bg-bg px-2 py-1.5">
            {[100, 30, 15, 10, 5, 2].map((v) => <option key={v} value={v}>{v === 100 ? "Any" : `${v}%`}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={startersOnly} onChange={(e) => setStartersOnly(e.target.checked)} className="accent-[var(--accent)]" />
          Likely to play
        </label>
        <label className="ml-auto flex items-center gap-2">
          <span className="text-muted">Sort</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="rounded-lg border border-border bg-bg px-2 py-1.5">
            {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b border-border text-left text-xs text-muted">
            <tr>
              <th className="px-3 py-2 font-medium">Player</th>
              <th className="px-2 py-2 text-right font-medium">Price</th>
              <th className="px-2 py-2 text-right font-medium">Own</th>
              <th className="px-2 py-2 text-right font-medium">Play%</th>
              {gws.map((g) => <th key={g} className="px-2 py-2 text-right font-medium">GW{g}</th>)}
              <th className="px-3 py-2 text-right font-semibold text-text">Total</th>
              <th className="px-2 py-2 font-medium">Fixtures</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((p) => (
              <Fragment key={p.id}>
                <tr id={`p-${p.id}`} onClick={() => setOpen(open === p.id ? null : p.id)} className={`cursor-pointer border-b border-border hover:bg-surface-2/60 ${open === p.id ? "bg-surface-2/60" : ""}`}>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium">{p.name}</span>
                      <StatusDot status={p.status} chance={p.chance} news={p.news} />
                      {p.ext?.label && <span title={p.ext.label} className="rounded bg-accent-soft px-1 text-[10px] text-accent">EU</span>}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted">{p.teamShort} <PosBadge pos={p.pos} /></div>
                  </td>
                  <td className="px-2 py-2 text-right tabular">{p.price.toFixed(1)}</td>
                  <td className="px-2 py-2 text-right tabular text-muted">{fmt.pct(p.ownership)}</td>
                  <td className="px-2 py-2 text-right tabular text-muted">{Math.round(p.pPlay * 100)}</td>
                  {p.byGw.map((v, i) => (
                    <td key={i} className="px-2 py-2 text-right tabular" style={{ opacity: v === 0 ? 0.4 : 1 }}>{v.toFixed(1)}</td>
                  ))}
                  <td className="px-3 py-2 text-right tabular font-semibold">{p.xpts.toFixed(1)}</td>
                  <td className="px-2 py-2">
                    <div className="flex gap-1">{p.fixtures.slice(0, 5).map((f, i) => <FixtureChip key={i} f={f} compact />)}</div>
                  </td>
                </tr>
                {open === p.id && (
                  <tr className="border-b border-border bg-surface-2/30">
                    <td colSpan={6 + gws.length}><PlayerBreakdown p={p} gws={gws} /></td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="p-6 text-center text-sm text-muted">No players match these filters.</p>}
      </div>
      {rows.length > limit && (
        <button onClick={() => setLimit(limit + 60)} className="w-full rounded-lg border border-border py-2 text-sm hover:bg-surface-2">
          Show more ({rows.length - limit} remaining)
        </button>
      )}
    </div>
  );
}
