import { loadSeason } from "@/lib/data/season";
import { loadExternal } from "@/lib/external/apply";

async function main() {
  const s = await loadSeason();
  const ext = await loadExternal(s.bootstrap, s.fixtures);
  const team = new Map(s.bootstrap.teams.map((t) => [t.id, t.short_name]));
  const fx = new Map(s.fixtures.map((f) => [f.id, f]));
  console.log("Congestion multipliers (P(start)) for upcoming PL fixtures:");
  for (const [k, v] of [...(ext.minutesMultipliers ?? new Map())].sort()) {
    const [t, f] = k.split(":").map(Number);
    const fix = fx.get(f)!;
    console.log(`  GW${fix.event} ${team.get(t)} (${fix.kickoff_time?.slice(0, 10)} vs ${team.get(fix.team_h === t ? fix.team_a : fix.team_h)}) x${v.toFixed(2)}`);
  }
  const el = new Map(s.bootstrap.elements.map((e) => [e.id, e]));
  const adj = [...(ext.attackAdjust ?? new Map())].sort((a, b) => Math.abs(b[1] - 1) - Math.abs(a[1] - 1)).slice(0, 12);
  console.log("\nBiggest all-comps form adjustments:");
  for (const [id, v] of adj) console.log(`  ${el.get(id)!.web_name} (${team.get(el.get(id)!.team)}) x${v.toFixed(2)}  ${ext.info?.get(id)?.label}`);
}
main();
