import { Suspense } from "react";
import { getAppData } from "@/lib/data/app";
import { FixtureChip } from "@/components/ui";

export default function Page() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Fixture ticker</h1>
        <p className="mt-1 text-sm text-muted">
          Coloured by expected goal difference from our team ratings (built from xG), not FPL&apos;s 1–5 difficulty. Sorted by the easiest run.
        </p>
      </div>
      <Suspense fallback={<p className="text-muted">Loading fixtures…</p>}>
        <Ticker />
      </Suspense>
    </div>
  );
}

async function Ticker() {
  const d = await getAppData();
  const teams = [...d.teams].sort((a, b) => sum(b.fixtures.map((f) => f.ease)) - sum(a.fixtures.map((f) => f.ease)));
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="border-b border-border text-xs text-muted">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Team</th>
            <th className="px-2 py-2 text-right font-medium" title="Attack rating: 1.00 = league average">Att</th>
            <th className="px-2 py-2 text-right font-medium" title="Defence rating: lower is better">Def</th>
            {d.gws.map((g) => <th key={g} className="px-2 py-2 font-medium">GW{g}</th>)}
            <th className="px-3 py-2 text-right font-medium">Run</th>
          </tr>
        </thead>
        <tbody>
          {teams.map((t) => (
            <tr key={t.id} className="border-b border-border last:border-0">
              <td className="px-3 py-2 font-medium">{t.name}</td>
              <td className="px-2 py-2 text-right tabular">{t.attack.toFixed(2)}</td>
              <td className="px-2 py-2 text-right tabular">{t.defence.toFixed(2)}</td>
              {d.gws.map((g) => {
                const fs = t.fixtures.filter((f) => f.gw === g);
                return (
                  <td key={g} className="px-2 py-2 text-center">
                    <div className="flex justify-center gap-1">
                      {fs.length ? fs.map((f, i) => <FixtureChip key={i} f={f} />) : <span className="text-xs text-muted">—</span>}
                    </div>
                  </td>
                );
              })}
              <td className="px-3 py-2 text-right tabular font-medium">{fmtSigned(sum(t.fixtures.map((f) => f.ease)))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const sum = (xs: number[]) => xs.reduce((s, v) => s + v, 0);
const fmtSigned = (v: number) => {
  const r = Math.round(v * 10) / 10;
  return r === 0 ? "0.0" : `${r > 0 ? "+" : ""}${r.toFixed(1)}`;
};
