/**
 * Minimal gradient-boosted regression trees (histogram splits, squared or absolute loss).
 * Small and dependency-free so a trained model can be shipped as JSON and evaluated in TS.
 */
export interface TreeNode {
  f?: number; // feature index (internal node)
  t?: number; // threshold: go left if x[f] <= t
  l?: TreeNode;
  r?: TreeNode;
  v?: number; // leaf value
}
export interface GbmModel {
  base: number;
  lr: number;
  trees: TreeNode[];
  features: string[];
}

export interface GbmOptions {
  rounds?: number;
  lr?: number;
  depth?: number;
  minLeaf?: number;
  bins?: number;
  loss?: "l2" | "l1";
  subsample?: number;
  seed?: number;
}

function quantileThresholds(col: number[], bins: number): number[] {
  const s = [...col].sort((a, b) => a - b);
  const out = new Set<number>();
  for (let i = 1; i < bins; i++) out.add(s[Math.floor((i / bins) * (s.length - 1))]);
  return [...out].sort((a, b) => a - b);
}

export function trainGbm(X: number[][], y: number[], features: string[], opts: GbmOptions = {}): GbmModel {
  const rounds = opts.rounds ?? 200;
  const lr = opts.lr ?? 0.05;
  const depth = opts.depth ?? 3;
  const minLeaf = opts.minLeaf ?? 50;
  const loss = opts.loss ?? "l2";
  const sub = opts.subsample ?? 0.8;
  let seed = opts.seed ?? 1;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const k = X[0].length;
  const thresholds = Array.from({ length: k }, (_, j) => quantileThresholds(X.map((r) => r[j]), opts.bins ?? 32));
  const median = (v: number[]) => {
    const s = [...v].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)] ?? 0;
  };
  const base = loss === "l1" ? median(y) : y.reduce((s, v) => s + v, 0) / y.length;
  const pred = new Array(y.length).fill(base);
  const trees: TreeNode[] = [];

  const build = (idx: number[], g: number[], d: number): TreeNode => {
    const leafValue = () => (loss === "l1" ? median(idx.map((i) => y[i] - pred[i])) : idx.reduce((s, i) => s + g[i], 0) / idx.length);
    if (d === 0 || idx.length < 2 * minLeaf) return { v: leafValue() };
    const total = idx.reduce((s, i) => s + g[i], 0);
    let best = { gain: 0, f: -1, t: 0 };
    for (let f = 0; f < k; f++) {
      const ths = thresholds[f];
      // bucket sums
      const sum = new Array(ths.length + 1).fill(0);
      const cnt = new Array(ths.length + 1).fill(0);
      for (const i of idx) {
        const x = X[i][f];
        let lo = 0;
        let hi = ths.length;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (x <= ths[mid]) hi = mid;
          else lo = mid + 1;
        }
        sum[lo] += g[i];
        cnt[lo]++;
      }
      let ls = 0;
      let lc = 0;
      for (let b = 0; b < ths.length; b++) {
        ls += sum[b];
        lc += cnt[b];
        const rc = idx.length - lc;
        if (lc < minLeaf || rc < minLeaf) continue;
        const rs = total - ls;
        const gain = (ls * ls) / lc + (rs * rs) / rc - (total * total) / idx.length;
        if (gain > best.gain) best = { gain, f, t: ths[b] };
      }
    }
    if (best.f < 0) return { v: leafValue() };
    const left = idx.filter((i) => X[i][best.f] <= best.t);
    const right = idx.filter((i) => X[i][best.f] > best.t);
    return { f: best.f, t: best.t, l: build(left, g, d - 1), r: build(right, g, d - 1) };
  };

  for (let m = 0; m < rounds; m++) {
    const g = y.map((v, i) => (loss === "l1" ? Math.sign(v - pred[i]) : v - pred[i]));
    const idx: number[] = [];
    for (let i = 0; i < y.length; i++) if (rnd() < sub) idx.push(i);
    const tree = build(idx, g, depth);
    trees.push(tree);
    for (let i = 0; i < y.length; i++) pred[i] += lr * evalTree(tree, X[i]);
  }
  return { base, lr, trees, features };
}

export function evalTree(t: TreeNode, x: number[]): number {
  let n = t;
  while (n.v === undefined) n = x[n.f!] <= n.t! ? n.l! : n.r!;
  return n.v;
}

export function predictGbm(m: GbmModel, x: number[]): number {
  return m.trees.reduce((s, t) => s + m.lr * evalTree(t, x), m.base);
}
