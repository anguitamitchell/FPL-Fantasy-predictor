import type { FixtureProjection, Pos } from "./types";

/** Per-component multipliers (+ per-position intercept) fitted on past seasons. */
export interface Calibration {
  fittedOn: string;
  scale: Record<keyof FixtureProjection["components"], number>;
  intercept: Record<Pos, number>;
}

export const COMPONENT_KEYS = ["appearance", "goals", "assists", "cleanSheet", "goalsConceded", "saves", "defCon", "bonus", "cards"] as const;

/** Solves (XᵀX + λI)β = Xᵀy by Gaussian elimination (small dense systems only). */
export function ridge(X: number[][], y: number[], lambda: number, unpenalised: Set<number> = new Set()): number[] {
  const k = X[0].length;
  const A = Array.from({ length: k }, () => new Array(k).fill(0));
  const b = new Array(k).fill(0);
  for (let r = 0; r < X.length; r++) {
    const row = X[r];
    for (let i = 0; i < k; i++) {
      if (row[i] === 0) continue;
      b[i] += row[i] * y[r];
      for (let j = 0; j < k; j++) A[i][j] += row[i] * row[j];
    }
  }
  for (let i = 0; i < k; i++) if (!unpenalised.has(i)) A[i][i] += lambda;
  // Gaussian elimination with partial pivoting
  for (let c = 0; c < k; c++) {
    let p = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    [b[c], b[p]] = [b[p], b[c]];
    if (Math.abs(A[c][c]) < 1e-12) continue;
    for (let r = c + 1; r < k; r++) {
      const f = A[r][c] / A[c][c];
      for (let j = c; j < k; j++) A[r][j] -= f * A[c][j];
      b[r] -= f * b[c];
    }
  }
  const beta = new Array(k).fill(0);
  for (let i = k - 1; i >= 0; i--) {
    let s = b[i];
    for (let j = i + 1; j < k; j++) s -= A[i][j] * beta[j];
    beta[i] = Math.abs(A[i][i]) < 1e-12 ? 0 : s / A[i][i];
  }
  return beta;
}

/** Applies a calibration to one fixture projection (keeps components consistent with the total). */
export function applyCalibration(f: FixtureProjection, pos: Pos, cal: Calibration): FixtureProjection {
  const components = { ...f.components };
  for (const k of COMPONENT_KEYS) components[k] = f.components[k] * cal.scale[k];
  // Intercept only applies when the player is expected to play.
  const xpts = Object.values(components).reduce((s, v) => s + v, 0) + cal.intercept[pos] * f.pPlay;
  return { ...f, components, xpts };
}
