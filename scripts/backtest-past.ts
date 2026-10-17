import { getBootstrap } from "@/lib/fpl/client";
import { loadPastSeason } from "@/lib/backtest/vaastav";
import { backtest, type BacktestRow } from "@/lib/model/backtest";

/**
 * Walk-forward backtest over a full past season. Needs the public vaastav CSVs:
 *   .data/vaastav-2025-26/{merged_gw,fixtures,teams,players_raw}.csv  (gws/merged_gw.csv upstream)
 *   .data/vaastav-2024-25/players_raw.csv                             (priors)
 * from https://github.com/vaastav/Fantasy-Premier-League/tree/master/data
 * Usage: npx tsx scripts/backtest-past.ts [all|played]
 */
async function main() {
  const scoring = (await getBootstrap()).game_config.scoring;
  const past = loadPastSeason(".data/vaastav-2025-26", ".data/vaastav-2024-25", scoring);
  const gws = Array.from({ length: 36 }, (_, i) => i + 3); // GW3..38
  const mode = (process.argv[2] as "all" | "played") ?? "all";
  console.log(`evaluation: ${mode}`);
  const rows = backtest(past.bootstrapAt(1), past.fixtures, past.lives, past.priors, gws, {
    bootstrapAt: past.bootstrapAt,
    benchmark: past.fplXp,
    evaluate: mode,
  });
  const avg = (k: keyof BacktestRow) => rows.reduce((s, r) => s + ((r[k] as number) ?? 0), 0) / rows.length;
  const f = (v: number) => v.toFixed(3);
  console.log(`2025/26 GW3-38 walk-forward (n≈${Math.round(avg("n"))} players/GW)`);
  console.log(`             MAE    Spearman  Top-50 avg pts`);
  console.log(`model      ${f(avg("maeModel"))}  ${f(avg("spearmanModel"))}    ${f(avg("top50HitModel"))}`);
  console.log(`form (4GW) ${f(avg("maeForm"))}  ${f(avg("spearmanForm"))}    ${f(avg("top50HitForm"))}`);
  const withBench = rows.filter((r) => r.spearmanBench !== undefined);
  const a2 = (k: keyof BacktestRow) => withBench.reduce((s, r) => s + ((r[k] as number) ?? 0), 0) / withBench.length;
  console.log(`\nOn the ${withBench.length} GWs where FPL's xP was captured:`);
  console.log(`model      ${f(a2("maeModel"))}  ${f(a2("spearmanModel"))}    ${f(a2("top50HitModel"))}`);
  console.log(`FPL xP     ${f(a2("maeBench"))}  ${f(a2("spearmanBench"))}    ${f(a2("top50HitBench"))}`);
  const wins = withBench.filter((r) => r.spearmanModel > r.spearmanBench!).length;
  console.log(`model beats FPL xP on rank correlation in ${wins}/${withBench.length} of those GWs`);
}
main();
