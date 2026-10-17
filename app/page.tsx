import Link from "next/link";
import { Suspense } from "react";
import { getAppData } from "@/lib/data/app";
import type { AppData, PlayerRow } from "@/lib/data/view";
import { Card, FixtureChip, PosBadge, StatusDot, fmt } from "@/components/ui";
import { Deadline } from "@/components/Deadline";

export default function Page() {
  return (
    <Suspense fallback={<p className="text-muted">Crunching the numbers…</p>}>
      <Dashboard />
    </Suspense>
  );
}

async function Dashboard() {
  const d = await getAppData();
  const playing = d.players.filter((p) => p.pPlay >= 0.6);
  const captains = [...playing].sort((a, b) => b.next - a.next).slice(0, 6);
  const value = [...playing].filter((p) => p.price <= 7).sort((a, b) => b.xptsPerM - a.xptsPerM).slice(0, 8);
  const rises = d.players
    .filter((p) => p.priceTrend && p.priceTrend.tonight >= 100 && p.priceTrend.likelihood >= 4)
    .sort((a, b) => b.priceTrend!.tonight - a.priceTrend!.tonight)
    .slice(0, 8);
  const falls = d.players
    .filter((p) => p.priceTrend && p.priceTrend.tonight <= -100 && p.priceTrend.likelihood <= -4 && p.ownership >= 1)
    .sort((a, b) => a.priceTrend!.tonight - b.priceTrend!.tonight)
    .slice(0, 8);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Gameweek {d.nextGw}</h1>
          <p className="mt-1 text-sm text-muted">
            Deadline {d.deadline ? <Deadline iso={d.deadline} /> : "TBC"} · projections for GW{d.gws[0]}–{d.gws[d.gws.length - 1]}
          </p>
        </div>
        <div className="flex gap-2 text-sm">
          <Link href="/team" className="rounded-lg bg-accent px-3 py-2 font-medium text-accent-text">Plan my transfers</Link>
          <Link href="/differentials" className="rounded-lg border border-border px-3 py-2">Differentials</Link>
        </div>
      </div>

      <Card title="Captain picks" subtitle={`Highest expected points for GW${d.nextGw}. Haul = chance of 10+ points.`}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {captains.map((p, i) => (
            <div key={p.id} className="rounded-lg border border-border bg-surface-2/50 p-3">
              <div className="flex items-center justify-between text-xs text-muted">
                <span>#{i + 1}</span>
                <span>{fmt.pct(p.ownership)} owned</span>
              </div>
              <div className="mt-1 flex items-center gap-1 font-semibold">
                <Link href={`/players?focus=${p.id}`} className="truncate hover:underline">{p.name}</Link>
                <StatusDot status={p.status} chance={p.chance} news={p.news} />
              </div>
              <div className="text-xs text-muted">{p.teamShort} · {p.pos} · {fmt.price(p.price)}</div>
              <div className="mt-2 flex flex-wrap gap-1">
                {p.fixtures.filter((f) => f.gw === d.nextGw).map((f, j) => <FixtureChip key={j} f={f} compact />)}
              </div>
              <div className="mt-3 grid grid-cols-3 gap-1 text-center">
                <Stat label="xPts" value={fmt.pts(p.next)} strong />
                <Stat label="Haul" value={`${Math.round(p.pHaul * 100)}%`} />
                <Stat label="Ceiling" value={p.ceiling.toFixed(0)} />
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {(["GKP", "DEF", "MID", "FWD"] as const).map((pos) => (
          <Card key={pos} title={`Top ${posName(pos)}`} subtitle={`Ranked by expected points over the next ${d.gws.length} GWs`}>
            <PlayerList players={playing.filter((p) => p.pos === pos).slice(0, 6)} d={d} />
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card title="Best value (≤ £7.0m)" subtitle="Expected points per £m over the horizon">
          <PlayerList players={value} d={d} metric={(p) => `${p.xptsPerM.toFixed(2)}/m`} />
        </Card>
        <Card title="Likely price rises" subtitle="FPL's own projection for tonight">
          {rises.length ? <PlayerList players={rises} d={d} metric={(p) => `${p.priceTrend!.tonight.toFixed(0)}%`} /> : <Empty />}
        </Card>
        <Card title="Likely price falls" subtitle="Owned by ≥1%: sell before they drop">
          {falls.length ? <PlayerList players={falls} d={d} metric={(p) => `${p.priceTrend!.tonight.toFixed(0)}%`} /> : <Empty />}
        </Card>
      </div>
    </div>
  );
}

function posName(p: string) {
  return { GKP: "goalkeepers", DEF: "defenders", MID: "midfielders", FWD: "forwards" }[p];
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded bg-surface px-1 py-1">
      <div className={`tabular ${strong ? "text-lg font-semibold text-accent" : "text-sm font-medium"}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
    </div>
  );
}

function Empty() {
  return <p className="text-sm text-muted">Nothing projected right now.</p>;
}

function PlayerList({ players, d, metric }: { players: PlayerRow[]; d: AppData; metric?: (p: PlayerRow) => string }) {
  return (
    <ul className="divide-y divide-border">
      {players.map((p) => (
        <li key={p.id} className="flex items-center gap-3 py-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <Link href={`/players?focus=${p.id}`} className="truncate font-medium hover:underline">{p.name}</Link>
              <StatusDot status={p.status} chance={p.chance} news={p.news} />
              <PosBadge pos={p.pos} />
            </div>
            <div className="text-xs text-muted">
              {p.teamShort} · {fmt.price(p.price)} · {fmt.pct(p.ownership)}
            </div>
          </div>
          <div className="hidden gap-1 sm:flex">
            {p.fixtures.slice(0, 3).map((f, i) => <FixtureChip key={i} f={f} compact />)}
          </div>
          <div className="w-16 text-right">
            <div className="tabular font-semibold">{metric ? metric(p) : fmt.pts(p.xpts)}</div>
            {!metric && <div className="text-[10px] text-muted">xPts {d.gws.length}GW</div>}
          </div>
        </li>
      ))}
    </ul>
  );
}
