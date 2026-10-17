import type { Bootstrap, Fixture, Live } from "@/lib/fpl/schemas";
import { buildModel, type ModelInput } from "./build";
import type { PlayerPrior } from "./types";

export interface BacktestRow {
  gw: number;
  n: number;
  maeModel: number;
  maeForm: number;
  spearmanModel: number;
  spearmanForm: number;
  top50HitModel: number; // mean actual points of our top-50 picks
  top50HitForm: number;
}

function ranks(xs: number[]): number[] {
  const idx = xs.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const r = new Array(xs.length);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2;
    i = j + 1;
  }
  return r;
}
export function spearman(a: number[], b: number[]): number {
  const ra = ranks(a);
  const rb = ranks(b);
  const n = a.length;
  const ma = ra.reduce((s, v) => s + v, 0) / n;
  const mb = rb.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (ra[i] - ma) * (rb[i] - mb);
    da += (ra[i] - ma) ** 2;
    db += (rb[i] - mb) ** 2;
  }
  return num / Math.sqrt(da * db);
}

/**
 * Walk-forward backtest: for each target GW, fit only on earlier GWs and predict that GW.
 * Player statuses are neutralised (we don't have historical injury flags), and the
 * baseline gets the same treatment, so the comparison is fair.
 */
export function backtest(
  bootstrap: Bootstrap,
  fixtures: Fixture[],
  lives: Map<number, Live>,
  priors: Map<number, PlayerPrior>,
  targetGws: number[],
  overrides: Partial<ModelInput> = {},
): BacktestRow[] {
  const neutral: Bootstrap = {
    ...bootstrap,
    elements: bootstrap.elements.map((e) => ({ ...e, status: "a", chance_of_playing_next_round: null, news: "" })),
  };
  const rows: BacktestRow[] = [];
  for (const gw of targetGws) {
    const past = new Map([...lives].filter(([g]) => g < gw));
    const actual = lives.get(gw);
    if (!actual || past.size === 0) continue;
    // Fixtures must look "unfinished" from gw onwards so nothing leaks into ratings.
    const fx = fixtures.map((f) => (f.event != null && f.event >= gw ? { ...f, finished: false } : f));
    const model = buildModel({ bootstrap: neutral, fixtures: fx, lives: past, priors, now: new Date(0), horizon: 1, startGw: gw, ...overrides });
    const actualPts = new Map(actual.elements.map((e) => [e.id, e.stats.total_points]));
    const actualMin = new Map(actual.elements.map((e) => [e.id, e.stats.minutes]));
    const pred: number[] = [];
    const form: number[] = [];
    const act: number[] = [];
    for (const p of model.players.values()) {
      // Evaluate on players who had any minutes in the past or this GW (ignores the long tail of 0s).
      const pastMin = p.history.reduce((s, h) => s + h.minutes, 0);
      if (pastMin === 0 && (actualMin.get(p.element.id) ?? 0) === 0) continue;
      const recent = p.history.filter((h) => h.gw >= gw - 4);
      const f = recent.length ? recent.reduce((s, h) => s + h.points, 0) / recent.length : 0;
      pred.push(p.byGw[gw] ?? 0);
      form.push(f);
      act.push(actualPts.get(p.element.id) ?? 0);
    }
    const mae = (xs: number[]) => xs.reduce((s, v, i) => s + Math.abs(v - act[i]), 0) / xs.length;
    const topHit = (xs: number[]) => {
      const idx = xs.map((v, i) => [v, i] as const).sort((a, b) => b[0] - a[0]).slice(0, 50);
      return idx.reduce((s, [, i]) => s + act[i], 0) / idx.length;
    };
    rows.push({
      gw,
      n: act.length,
      maeModel: mae(pred),
      maeForm: mae(form),
      spearmanModel: spearman(pred, act),
      spearmanForm: spearman(form, act),
      top50HitModel: topHit(pred),
      top50HitForm: topHit(form),
    });
  }
  return rows;
}
