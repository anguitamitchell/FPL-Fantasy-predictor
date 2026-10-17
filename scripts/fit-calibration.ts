import { writeFileSync } from "fs";
import { getBootstrap } from "@/lib/fpl/client";
import { loadPastSeason } from "@/lib/backtest/vaastav";
import { loadSeason } from "@/lib/data/season";
import { loadPriors } from "@/lib/data/priors";
import { buildModel } from "@/lib/model/build";
import { spearman } from "@/lib/model/backtest";
import { COMPONENT_KEYS, ridge, type Calibration } from "@/lib/model/calibration";
import type { Bootstrap, Fixture, Live } from "@/lib/fpl/schemas";
import type { PlayerPrior, Pos } from "@/lib/model/types";

const POSITIONS: Pos[] = ["GKP", "DEF", "MID", "FWD"];
type Row = { comps: number[]; pPlay: number; pos: Pos; actual: number; played: boolean };

/** Walk-forward rows: features are the v1 model's per-component projections for the target GW. */
function collect(bootstrapAt: (gw: number) => Bootstrap, fixtures: Fixture[], lives: Map<number, Live>, priors: Map<number, PlayerPrior>, gws: number[]): Row[] {
  const rows: Row[] = [];
  for (const gw of gws) {
    const past = new Map([...lives].filter(([g]) => g < gw));
    const actual = lives.get(gw);
    if (!actual || !past.size) continue;
    const b = bootstrapAt(gw);
    const neutral = { ...b, elements: b.elements.map((e) => ({ ...e, status: "a", chance_of_playing_next_round: null, news: "" })) };
    const fx = fixtures.map((f) => (f.event != null && f.event >= gw ? { ...f, finished: false } : f));
    const m = buildModel({ bootstrap: neutral, fixtures: fx, lives: past, priors, now: new Date(0), horizon: 1, startGw: gw });
    const pts = new Map(actual.elements.map((e) => [e.id, e.stats.total_points]));
    const mins = new Map(actual.elements.map((e) => [e.id, e.stats.minutes]));
    for (const p of m.players.values()) {
      const pastMin = p.history.reduce((s, h) => s + h.minutes, 0);
      const played = (mins.get(p.element.id) ?? 0) > 0;
      if (pastMin === 0 && !played) continue;
      const comps = COMPONENT_KEYS.map((k) => p.fixtures.reduce((s, f) => s + f.components[k], 0));
      rows.push({ comps, pPlay: p.fixtures.reduce((s, f) => s + f.pPlay, 0), pos: p.pos, actual: pts.get(p.element.id) ?? 0, played });
    }
  }
  return rows;
}

const features = (r: Row) => [...r.comps, ...POSITIONS.map((p) => (r.pos === p ? r.pPlay : 0))];
const v1 = (r: Row) => r.comps.reduce((s, v) => s + v, 0);

function score(rows: Row[], pred: (r: Row) => number) {
  const p = rows.map(pred);
  const a = rows.map((r) => r.actual);
  const mae = p.reduce((s, v, i) => s + Math.abs(v - a[i]), 0) / p.length;
  const bias = p.reduce((s, v, i) => s + v - a[i], 0) / p.length;
  return { mae: +mae.toFixed(3), spearman: +spearman(p, a).toFixed(3), bias: +bias.toFixed(3) };
}

async function main() {
  const scoring = (await getBootstrap()).game_config.scoring;
  const past = loadPastSeason(".data/vaastav-2025-26", ".data/vaastav-2024-25", scoring);
  const train = collect(past.bootstrapAt, past.fixtures, past.lives, past.priors, Array.from({ length: 36 }, (_, i) => i + 3));

  const cur = await loadSeason();
  const curPriors = await loadPriors(cur.bootstrap);
  const test = collect(() => cur.bootstrap, cur.fixtures, cur.lives, curPriors, [...cur.lives.keys()].filter((g) => g >= 2));

  const X = train.map(features);
  const y = train.map((r) => r.actual);
  // Shrink component scales towards 1 (not 0): fit residual y - v1 on the same features.
  const resid = train.map((r, i) => y[i] - v1(r));
  const delta = ridge(X, resid, 200, new Set([9, 10, 11, 12]));
  const beta = delta.map((d, i) => (i < COMPONENT_KEYS.length ? 1 + d : d));
  const cal: Calibration = {
    fittedOn: "2025/26 GW3-38 (vaastav), walk-forward v1 projections",
    scale: Object.fromEntries(COMPONENT_KEYS.map((k, i) => [k, +beta[i].toFixed(3)])) as Calibration["scale"],
    intercept: Object.fromEntries(POSITIONS.map((p, i) => [p, +beta[COMPONENT_KEYS.length + i].toFixed(3)])) as Calibration["intercept"],
  };
  const calibrated = (r: Row) => features(r).reduce((s, v, i) => s + v * beta[i], 0);

  console.log("calibration:", JSON.stringify(cal, null, 1));
  console.log(`train rows ${train.length}, test rows ${test.length}`);
  console.log("train  v1", score(train, v1), " calibrated", score(train, calibrated));
  console.log("TEST (2026/27 GW2-6, out of sample)");
  console.log("  all     v1", score(test, v1), " calibrated", score(test, calibrated));
  const played = test.filter((r) => r.played);
  console.log("  played  v1", score(played, v1), " calibrated", score(played, calibrated));
  writeFileSync(".data/calibration-candidate.json", JSON.stringify(cal, null, 2));
}
main();
