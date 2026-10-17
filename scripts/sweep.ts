import { loadSeason } from "@/lib/data/season";
import { loadPriors } from "@/lib/data/priors";
import { backtest } from "@/lib/model/backtest";

async function main() {
  const s = await loadSeason();
  const priors = await loadPriors(s.bootstrap);
  const gws = [...s.lives.keys()].filter((g) => g >= 2);
  const out: string[] = [];
  for (const aHL of [4, 8, 16])
    for (const posMin of [180, 360, 720])
      for (const lsW of [0.25, 0.5, 1])
        for (const mHL of [2, 3, 5]) {
          const rows = backtest(s.bootstrap, s.fixtures, s.lives, priors, gws, { overrides: {
            rateOptions: { attackHalfLife: aHL, positionPriorMinutes: posMin, lastSeasonWeight: lsW, minutesHalfLife: mHL },
          } });
          const avg = (f: (r: (typeof rows)[0]) => number) => rows.reduce((a, r) => a + f(r), 0) / rows.length;
          out.push(`${avg((r) => r.maeModel).toFixed(4)} sp ${avg((r) => r.spearmanModel).toFixed(4)} top ${avg((r) => r.top50HitModel).toFixed(2)}  aHL=${aHL} posMin=${posMin} lsW=${lsW} mHL=${mHL}`);
        }
  out.sort();
  console.log(out.slice(0, 12).join("\n"));
  console.log("...default:", out.find((l) => l.includes("aHL=8 posMin=360 lsW=0.5 mHL=3")));
}
main();
