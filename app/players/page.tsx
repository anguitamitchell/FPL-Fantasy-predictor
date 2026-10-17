import { Suspense } from "react";
import { getAppData } from "@/lib/data/app";
import { PlayerExplorer } from "@/components/PlayerExplorer";

export default function Page() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Players</h1>
        <p className="mt-1 text-sm text-muted">Every projection is broken down: click a row to see where the points come from.</p>
      </div>
      <Suspense fallback={<p className="text-muted">Loading players…</p>}>
        <Explorer />
      </Suspense>
    </div>
  );
}

async function Explorer() {
  const d = await getAppData();
  return <PlayerExplorer players={d.players} gws={d.gws} teams={d.teams.map((t) => ({ id: t.id, short: t.short }))} />;
}
