import type { PlayerRow } from "@/lib/data/view";
import { FixtureChip, fmt } from "./ui";

const LABELS: Record<string, string> = {
  appearance: "Minutes",
  goals: "Goals",
  assists: "Assists",
  cleanSheet: "Clean sheets",
  goalsConceded: "Goals conceded",
  saves: "Saves",
  defCon: "Def. contributions",
  bonus: "Bonus",
  cards: "Cards",
};

export function PlayerBreakdown({ p, gws }: { p: PlayerRow; gws: number[] }) {
  const entries = Object.entries(p.components).filter(([, v]) => Math.abs(v) >= 0.05).sort((a, b) => b[1] - a[1]);
  const maxPos = Math.max(0.01, ...entries.map(([, v]) => v));
  return (
    <div className="grid gap-5 p-4 text-sm md:grid-cols-3">
      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Where the {fmt.pts(p.xpts)} xPts come from</h4>
        <ul className="space-y-1.5">
          {entries.map(([k, v]) => (
            <li key={k} className="flex items-center gap-2">
              <span className="w-32 shrink-0 text-muted">{LABELS[k] ?? k}</span>
              <span className="h-2 flex-1 rounded bg-surface-2">
                {v > 0 && <span className="block h-2 rounded bg-accent" style={{ width: `${(v / maxPos) * 100}%` }} />}
              </span>
              <span className={`w-10 text-right tabular ${v < 0 ? "text-bad" : ""}`}>{v.toFixed(1)}</span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">By gameweek</h4>
        <ul className="space-y-1">
          {gws.map((g, i) => (
            <li key={g} className="flex items-center gap-2">
              <span className="w-12 text-muted">GW{g}</span>
              <span className="flex flex-1 flex-wrap gap-1">
                {p.fixtures.filter((f) => f.gw === g).map((f, j) => <FixtureChip key={j} f={f} compact />)}
                {!p.fixtures.some((f) => f.gw === g) && <span className="text-xs text-muted">Blank</span>}
              </span>
              <span className="w-10 text-right tabular font-medium">{p.byGw[i].toFixed(1)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted">
          Next GW: {Math.round(p.pPlay * 100)}% to play, ~{p.expMins} mins expected · {Math.round(p.pHaul * 100)}% chance of 10+
        </p>
      </div>
      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Season so far</h4>
        <dl className="grid grid-cols-3 gap-2">
          <Kv k="Points" v={p.season.points} />
          <Kv k="Minutes" v={p.season.minutes} />
          <Kv k="Starts" v={p.season.starts} />
          <Kv k="Goals" v={`${p.season.goals} (${p.season.xg} xG)`} />
          <Kv k="Assists" v={`${p.season.assists} (${p.season.xa} xA)`} />
          <Kv k="xGI/90" v={p.season.xgi90} />
          <Kv k="Bonus" v={p.season.bonus} />
          <Kv k="Def. contr." v={p.season.dc} />
          <Kv k="FPL ep_next" v={p.epNext ?? "–"} />
        </dl>
        {p.ext && (
          <p className="mt-3 text-xs text-muted">
            All competitions: {p.ext.comps} non-PL matches, {p.ext.mins14d} mins in the last 14 days
            {p.ext.minutesFactor < 0.99 && ` · rotation risk applied (×${p.ext.minutesFactor.toFixed(2)} start chance)`}
            {p.ext.label && ` · ${p.ext.label}`}
          </p>
        )}
        {p.news && <p className="mt-3 rounded-md bg-surface-2 px-2 py-1.5 text-xs">{p.news}</p>}
      </div>
    </div>
  );
}

function Kv({ k, v }: { k: string; v: string | number }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-muted">{k}</dt>
      <dd className="tabular font-medium">{v}</dd>
    </div>
  );
}
