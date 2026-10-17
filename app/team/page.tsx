import { Suspense } from "react";
import { getAppData } from "@/lib/data/app";
import { TeamBuilder, type SlimPlayer } from "@/components/TeamBuilder";

export default function Page() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">My team</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Import your squad with your FPL ID, or build one by hand, then let the optimiser find the best transfers. It respects your budget
          (real selling prices), the 3-per-club rule and valid formations, and charges 4 points per hit.
        </p>
      </div>
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <Builder />
      </Suspense>
    </div>
  );
}

async function Builder() {
  const d = await getAppData();
  const players: SlimPlayer[] = d.players.map((p) => ({
    id: p.id,
    name: p.name,
    team: p.team,
    teamShort: p.teamShort,
    pos: p.pos,
    price: p.price,
    ownership: p.ownership,
    xpts: p.xpts,
    byGw: p.byGw,
    status: p.status,
    chance: p.chance,
    news: p.news,
    fixtures: p.fixtures,
    inactive: p.inactive,
  }));
  return <TeamBuilder players={players} gws={d.gws} />;
}
