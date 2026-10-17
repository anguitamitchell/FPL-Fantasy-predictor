import { loadSeason } from "@/lib/data/season";
import { loadPriors } from "@/lib/data/priors";
import { backtest } from "@/lib/model/backtest";

async function main() {
  const s = await loadSeason();
  const priors = await loadPriors(s.bootstrap);
  const gws = [...s.lives.keys()].filter((g) => g >= 2).sort((a, b) => a - b);
  const rows = backtest(s.bootstrap, s.fixtures, s.lives, priors, gws);
  console.table(rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Number(v.toFixed(3))]))));
  const avg = (k: keyof (typeof rows)[0]) => (rows.reduce((s, r) => s + (r[k] as number), 0) / rows.length).toFixed(3);
  console.log(`mean  MAE model ${avg("maeModel")} form ${avg("maeForm")} | spearman model ${avg("spearmanModel")} form ${avg("spearmanForm")} | top50 model ${avg("top50HitModel")} form ${avg("top50HitForm")}`);
}
main();
