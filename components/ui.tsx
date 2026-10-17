import type { ReactNode } from "react";
import type { FixtureCell } from "@/lib/data/view";

export function Card({ title, subtitle, children, action }: { title?: ReactNode; subtitle?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
      {(title || action) && (
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-base font-semibold">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/** Maps expected goal difference to a 1 (hard) .. 5 (easy) bucket. */
export function easeBucket(ease: number): 1 | 2 | 3 | 4 | 5 {
  if (ease <= -0.7) return 1;
  if (ease <= -0.25) return 2;
  if (ease < 0.25) return 3;
  if (ease < 0.7) return 4;
  return 5;
}

export function FixtureChip({ f, compact }: { f: FixtureCell; compact?: boolean }) {
  const b = easeBucket(f.ease);
  const color = b === 1 || b === 5 ? "var(--fx-text-light)" : "var(--fx-text-dark)";
  return (
    <span
      title={`GW${f.gw} ${f.home ? "vs" : "@"} ${f.opp} · expected goal diff ${f.ease > 0 ? "+" : ""}${f.ease.toFixed(2)}`}
      className={`inline-flex items-center justify-center rounded font-medium tabular ${compact ? "min-w-10 px-1 py-0.5 text-[11px]" : "min-w-12 px-1.5 py-1 text-xs"}`}
      style={{ background: `var(--fx-${b})`, color }}
    >
      {f.opp}
      <span className="ml-0.5 opacity-75">{f.home ? "H" : "A"}</span>
    </span>
  );
}

export function StatusDot({ status, chance, news }: { status: string; chance: number | null; news: string }) {
  if (status === "a" && (chance === null || chance === 100)) return null;
  const c = status === "d" ? "var(--warn)" : "var(--bad)";
  return (
    <span title={news || "Flagged"} className="ml-1 inline-block h-2 w-2 shrink-0 rounded-full align-middle" style={{ background: c }} />
  );
}

export function PosBadge({ pos }: { pos: string }) {
  return <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-muted">{pos}</span>;
}

export const fmt = {
  pts: (v: number) => v.toFixed(1),
  price: (v: number) => `£${v.toFixed(1)}m`,
  pct: (v: number, d = 1) => `${v.toFixed(d)}%`,
};
