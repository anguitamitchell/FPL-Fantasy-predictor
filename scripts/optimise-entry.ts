import { runModel } from "@/lib/data/season";
import { toAppData } from "@/lib/data/view";
import { importTeam } from "@/lib/team/fetch";
import { optimise, prunePool, type OptPlayer } from "@/lib/optimizer/squad";

async function main() {
  const id = Number(process.argv[2] ?? 1);
  const [d, team] = await Promise.all([runModel(5).then((m) => toAppData(m)), importTeam(id)]);
  const byId = new Map(d.players.map((p) => [p.id, p]));
  console.log(team.name, "| bank", team.bank / 10, "| FT", team.freeTransfers, "| chips", team.chipsAvailable.join(","), "| based on GW", team.basedOnGw);
  for (const s of team.squad) console.log(" ", byId.get(s.id)?.name ?? s.id, "buy", s.purchase / 10, "now", s.now / 10, "sell", s.sell / 10, "xp", byId.get(s.id)?.xpts);
  const all: OptPlayer[] = d.players.map((p) => ({ id: p.id, pos: p.pos, team: p.team, price: Math.round(p.price * 10), xp: p.byGw }));
  // Owned players missing from the view (filtered tail) still need to be in the pool.
  const pool = prunePool(all, new Set(team.squad.map((s) => s.id)));
  console.log("pool", pool.length);
  for (const k of [0, 1, 2, 3]) {
    const t0 = Date.now();
    const r = await optimise({ pool, owned: team.squad.map((s) => ({ id: s.id, sell: s.sell })), bank: team.bank, freeTransfers: team.freeTransfers, exactTransfers: k });
    const n = (ids: number[]) => ids.map((i) => byId.get(i)?.name ?? i).join(", ");
    console.log(`k=${k} ${r.status} ${Date.now() - t0}ms net ${r.netPoints.toFixed(1)} hits ${r.hits} bank ${r.bankAfter / 10} | out: ${n(r.transfersOut)} | in: ${n(r.transfersIn)} | C ${byId.get(r.lineups[0]?.captain)?.name}`);
  }
}
main();
