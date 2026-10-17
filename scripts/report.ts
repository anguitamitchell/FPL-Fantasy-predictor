import { runModel } from "@/lib/data/season";

async function main() {
  const m = await runModel(5);
  const teams = new Map(m.bootstrap.teams.map((t) => [t.id, t.short_name]));
  console.log(`latest finished GW ${m.latestGw}; projecting GWs ${m.gws.join(",")}; mu=${m.ratings.mu.toFixed(2)} home=${m.ratings.home.toFixed(3)}`);
  const tr = [...m.ratings.ratings.values()].sort((a, b) => b.attack / b.defence - a.attack / a.defence);
  console.log("team ratings (att, def):", tr.map((r) => `${teams.get(r.team)} ${r.attack.toFixed(2)}/${r.defence.toFixed(2)}`).join("  "));
  const g = m.gws[0];
  const rows = [...m.players.values()].sort((a, b) => b.byGw[g] - a.byGw[g]).slice(0, 30);
  console.log(`\nTop 30 by GW${g} xPts (ours vs FPL ep_next)`);
  for (const p of rows) {
    const f = p.fixtures[0];
    const c = f?.components;
    console.log(
      `${p.element.web_name.padEnd(16)} ${teams.get(p.element.team)} ${p.pos} £${(p.element.now_cost / 10).toFixed(1)}  ours ${p.byGw[g].toFixed(2)}  ep ${p.element.ep_next?.toFixed(1)}  5gw ${p.total.toFixed(1)}  ` +
        (f ? `vs ${teams.get(f.opponent)}${f.home ? "(H)" : "(A)"} pPlay ${f.pPlay.toFixed(2)} min ${f.expMinutes.toFixed(0)} | G ${c!.goals.toFixed(2)} A ${c!.assists.toFixed(2)} CS ${c!.cleanSheet.toFixed(2)} DC ${c!.defCon.toFixed(2)} B ${c!.bonus.toFixed(2)}` : ""),
    );
  }
  // Agreement with ep_next over regulars
  const reg = [...m.players.values()].filter((p) => p.element.ep_next != null && p.rates.seasonMinutes > 200);
  const mae = reg.reduce((s, p) => s + Math.abs(p.byGw[g] - (p.element.ep_next ?? 0)), 0) / reg.length;
  const meanOurs = reg.reduce((s, p) => s + p.byGw[g], 0) / reg.length;
  const meanEp = reg.reduce((s, p) => s + (p.element.ep_next ?? 0), 0) / reg.length;
  console.log(`\nregulars n=${reg.length} MAE vs ep_next ${mae.toFixed(2)}  mean ours ${meanOurs.toFixed(2)} mean ep ${meanEp.toFixed(2)}`);
  const dis = reg.sort((a, b) => Math.abs(b.byGw[g] - (b.element.ep_next ?? 0)) - Math.abs(a.byGw[g] - (a.element.ep_next ?? 0))).slice(0, 10);
  console.log("biggest disagreements:", dis.map((p) => `${p.element.web_name} ours ${p.byGw[g].toFixed(1)} ep ${p.element.ep_next} (${p.element.status} ${p.element.news.slice(0, 30)})`).join("\n  "));
}
main();
