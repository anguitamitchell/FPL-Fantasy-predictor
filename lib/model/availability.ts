/** Turns FPL status/news/chance-of-playing into a per-gameweek availability probability. */

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/** Parses "Expected back 25 Oct" / "Suspended until 02 Nov" style news into a date. */
export function parseReturnDate(news: string, now: Date): Date | null {
  const m = news.match(/(?:expected back|suspended until|until)\s+(\d{1,2})\s+([A-Za-z]{3})/i);
  if (!m) return null;
  const month = MONTHS[m[2].toLowerCase()];
  if (month === undefined) return null;
  let d = new Date(Date.UTC(now.getUTCFullYear(), month, Number(m[1])));
  // News written in Dec about January etc.
  if (d.getTime() < now.getTime() - 60 * 86400_000) d = new Date(Date.UTC(now.getUTCFullYear() + 1, month, Number(m[1])));
  return d;
}

export interface AvailabilityInput {
  status: string; // a, d, i, s, u, n
  chance: number | null; // chance_of_playing_next_round
  news: string;
}

/**
 * Availability for a gameweek `offset` GWs after the next one (0 = next GW), whose
 * deadline is `deadline`.
 */
export function availability(p: AvailabilityInput, offset: number, deadline: Date, now: Date): number {
  if (p.status === "u" || p.status === "n") return 0;
  const chance = p.chance === null ? null : p.chance / 100;
  if (p.status === "a") return chance ?? 1;

  const back = parseReturnDate(p.news, now);
  if (back) return deadline.getTime() >= back.getTime() ? 0.9 : 0;

  if (p.status === "s") return offset === 0 ? 0 : 1;
  const base = chance ?? (p.status === "d" ? 0.5 : 0);
  if (offset === 0) return base;
  // Without a return date, recover gradually across future gameweeks.
  const recovered = p.status === "d" ? 1 : Math.min(0.9, 0.2 + 0.2 * offset);
  return Math.max(base, recovered);
}
