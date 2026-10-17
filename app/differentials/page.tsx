import { Suspense } from "react";
import { getAppData } from "@/lib/data/app";
import { ownershipTrend } from "@/lib/data/snapshots";
import { DifferentialsView } from "@/components/DifferentialsView";

export default function Page() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Differentials</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Low-owned players the model rates highly, ranked by <span className="font-medium text-text">edge</span>: expected points × the share of
          managers who <em>don&apos;t</em> own them, i.e. points you gain on the field. Tags explain why each one looks undervalued.
        </p>
      </div>
      <Suspense fallback={<p className="text-muted">Finding differentials…</p>}>
        <Diffs />
      </Suspense>
    </div>
  );
}

async function Diffs() {
  const [d, trend] = await Promise.all([getAppData(), ownershipTrend(3).catch(() => null)]);
  return (
    <DifferentialsView
      players={d.players}
      gws={d.gws}
      ownDelta={trend ? Object.fromEntries(trend.delta) : null}
      trendWindow={trend ? `${trend.from} → ${trend.to}` : null}
    />
  );
}
