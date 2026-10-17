/** Small Poisson helpers used by the points model. */

export function poissonPmf(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 2; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

/** P(X >= k) for X ~ Poisson(lambda). */
export function poissonAtLeast(k: number, lambda: number): number {
  if (k <= 0) return 1;
  let cdf = 0;
  for (let i = 0; i < k; i++) cdf += poissonPmf(i, lambda);
  return Math.max(0, 1 - cdf);
}

/** E[floor(X / n)] for X ~ Poisson(lambda) — e.g. -1 per 2 goals conceded, +1 per 3 saves. */
export function expectedFloorDiv(lambda: number, n: number, maxK = 30): number {
  if (lambda <= 0) return 0;
  // E[floor(X/n)] = sum_{j>=1} P(X >= j*n)
  let total = 0;
  for (let j = 1; j * n <= maxK; j++) {
    const p = poissonAtLeast(j * n, lambda);
    total += p;
    if (p < 1e-6) break;
  }
  return total;
}

/**
 * P(X >= k) for a negative binomial with the given mean and variance/mean ratio
 * (dispersion > 1 means more spread than Poisson). Falls back to Poisson when ~1.
 */
export function negBinAtLeast(k: number, mean: number, dispersion: number): number {
  if (k <= 0) return 1;
  if (mean <= 0) return 0;
  if (dispersion <= 1.0001) return poissonAtLeast(k, mean);
  const variance = mean * dispersion;
  const p = mean / variance; // success prob
  const r = (mean * p) / (1 - p); // number of successes
  // pmf(0) = p^r; pmf(i+1) = pmf(i) * (i + r) / (i + 1) * (1 - p)
  let pmf = Math.pow(p, r);
  let cdf = 0;
  for (let i = 0; i < k; i++) {
    cdf += pmf;
    pmf = (pmf * (i + r) * (1 - p)) / (i + 1);
  }
  return Math.max(0, 1 - cdf);
}
