import type { Element, Team } from "@/lib/fpl/schemas";

export const normalise = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .replace(/ø/g, "o")
    .replace(/ł/g, "l")
    .replace(/đ/g, "d")
    .replace(/ß/g, "ss")
    .replace(/[’'`.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** ESPN abbreviations that differ from FPL short names. */
const TEAM_ALIASES: Record<string, string> = { MNC: "MCI", MAN: "MUN" };

export function mapTeams(espn: { id: string; displayName: string; abbreviation: string }[], fpl: Team[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of espn) {
    const abbr = TEAM_ALIASES[t.abbreviation] ?? t.abbreviation;
    const hit = fpl.find((f) => f.short_name === abbr) ?? fpl.find((f) => normalise(f.name) === normalise(t.displayName));
    if (hit) out.set(t.id, hit.id);
  }
  return out;
}

/**
 * Matches an ESPN player to an FPL player at the same club by name. Returns null when there
 * is no confident, unique match (better to skip than to attach the wrong player's minutes).
 */
export function matchPlayer(espnName: string, candidates: Element[]): number | null {
  const n = normalise(espnName);
  const tokens = n.split(" ");
  const last = tokens[tokens.length - 1];
  const scored = candidates.map((e) => {
    const full = normalise(`${e.first_name} ${e.second_name}`);
    const web = normalise(e.web_name);
    const second = normalise(e.second_name).split(" ");
    const first = normalise(e.first_name).split(" ");
    let score = 0;
    if (full === n) score = 100;
    else if (web === n) score = 90;
    else if (second.includes(last) && (first[0] === tokens[0] || tokens.length === 1)) score = 80;
    else if (web === last || web.split(" ").includes(last)) score = 60;
    else if (second.includes(last)) score = 50;
    else if (tokens.length === 1 && (first.includes(n) || second.includes(n))) score = 45;
    else if (full.includes(n) || n.includes(web)) score = 40;
    return { id: e.id, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score < 45) return null;
  if (scored[1] && scored[1].score === best.score) return null; // ambiguous
  return best.id;
}
