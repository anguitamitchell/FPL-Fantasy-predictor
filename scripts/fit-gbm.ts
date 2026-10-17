import { writeFileSync } from "fs";
import { getBootstrap } from "@/lib/fpl/client";
import { loadPastSeason } from "@/lib/backtest/vaastav";
import { loadSeason } from "@/lib/data/season";
import { loadPriors } from "@/lib/data/priors";
import { buildModel } from "@/lib/model/build";
import { spearman } from "@/lib/model/backtest";
import { trainGbm, predictGbm } from "@/lib/model/gbm";
import { COMPONENT_KEYS } from "@/lib/model/calibration";
import type { Bootstrap, Fixture, Live } from "@/lib/fpl/schemas";
import type { PlayerPrior } from "@/lib/model/types";

const FEATURES = [
  ...COMPONENT_KEYS, "v1", "pPlay", "p60", "expMins", "lambdaFor", "lambdaAgainst", "home", "fixtures",
  "price", "pos", "form4", "mins3", "starts3", "xgi90", "seasonMinutes",
];
type Row = { x: number[]; v1: number; actual: number; played: boolean; gw: number };

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
      const fs = p.fixtures;
      const sum = (f: (x: (typeof fs)[number]) => number) => fs.reduce((s, x) => s + f(x), 0);
      const recent = p.history.filter((h) => h.gw >= gw - 4);
      const last3 = p.history.filter((h) => h.gw >= gw - 3);
      const v1 = sum((f) => f.xpts);
      const x = [
        ...COMPONENT_KEYS.map((k) => sum((f) => f.components[k])),
        v1,
        sum((f) => f.pPlay),
        sum((f) => f.p60),
        sum((f) => f.expMinutes),
        fs.length ? sum((f) => f.lambdaFor) / fs.length : 0,
        fs.length ? sum((f) => f.lambdaAgainst) / fs.length : 0,
        fs.length ? sum((f) => (f.home ? 1 : 0)) / fs.length : 0.5,
        fs.length,
        p.element.now_cost,
        p.element.element_type,
        recent.length ? recent.reduce((s, h) => s + h.points, 0) / recent.length : 0,
        last3.reduce((s, h) => s + h.minutes, 0),
        last3.reduce((s, h) => s + h.starts, 0),
        pastMin > 0 ? (p.history.reduce((s, h) => s + h.xg + h.xa, 0) / pastMin) * 90 : 0,
        pastMin,
      ];
      rows.push({ x, v1, actual: pts.get(p.element.id) ?? 0, played, gw });
    }
  }
  return rows;
}

function score(rows: Row[], pred: (r: Row) => number) {
  const p = rows.map(pred);
  const a = rows.map((r) => r.actual);
  const mae = p.reduce((s, v, i) => s + Math.abs(v - a[i]), 0) / p.length;
  const top = (() => {
    // mean actual points of the top 50 predicted per GW
    const gws = [...new Set(rows.map((r) => r.gw))];
    let tot = 0;
    for (const g of gws) {
      const idx = rows.map((r, i) => [r, i] as const).filter(([r]) => r.gw === g).sort((x, y) => p[y[1]] - p[x[1]]).slice(0, 50);
      tot += idx.reduce((s, [r]) => s + r.actual, 0) / idx.length;
    }
    return tot / gws.length;
  })();
  return { mae: +mae.toFixed(3), spearman: +spearman(p, a).toFixed(3), top50: +top.toFixed(2) };
}

async function main() {
  const scoring = (await getBootstrap()).game_config.scoring;
  const past = loadPastSeason(".data/vaastav-2025-26", ".data/vaastav-2024-25", scoring);
  const train = collect(past.bootstrapAt, past.fixtures, past.lives, past.priors, Array.from({ length: 36 }, (_, i) => i + 3));
  const cur = await loadSeason();
  const test = collect(() => cur.bootstrap, cur.fixtures, cur.lives, await loadPriors(cur.bootstrap), [...cur.lives.keys()].filter((g) => g >= 2));
  console.log(`train ${train.length} rows, test ${test.length} rows`);
  for (const loss of ["l2", "l1"] as const) {
    const t0 = Date.now();
    const model = trainGbm(train.map((r) => r.x), train.map((r) => r.actual), FEATURES, { rounds: 250, lr: 0.05, depth: 3, minLeaf: 80, loss });
    const g = (r: Row) => predictGbm(model, r.x);
    console.log(`\nGBM loss=${loss} (${Date.now() - t0}ms)`);
    console.log("  train  v1", score(train, (r) => r.v1), " gbm", score(train, g));
    console.log("  TEST   v1", score(test, (r) => r.v1), " gbm", score(test, g));
    const played = test.filter((r) => r.played);
    console.log("  played v1", score(played, (r) => r.v1), " gbm", score(played, g));
    writeFileSync(`.data/gbm-${loss}.json`, JSON.stringify(model));
  }
}
main();
