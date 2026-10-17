import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { BootstrapSchema, type Fixture } from "@/lib/fpl/schemas";
import { parseSummary } from "@/lib/external/espn";
import { matchPlayer, normalise } from "@/lib/external/mapping";
import { congestionMultipliers, formAdjustment, CONGESTION } from "@/lib/external/apply";

const load = (f: string) => JSON.parse(readFileSync(`tests/fixtures/${f}`, "utf8"));
const bootstrap = BootstrapSchema.parse(load("bootstrap-static.json"));

describe("ESPN summary parsing (real Arsenal v Lille sample)", () => {
  const m = parseSummary(load("espn-summary-401915417.json"), "uefa.champions", "401915417", "2026-10-13T19:00Z");
  const by = (name: string) => m.players.find((p) => p.name === name)!;
  it("gives starters 90 and subs the minutes after they came on", () => {
    expect(by("David Raya").minutes).toBe(90);
    expect(by("Viktor Gyökeres").minutes).toBe(65); // subbed off at 64:36
    expect(by("Kai Havertz").minutes).toBe(25);
    expect(by("Kai Havertz").assists).toBe(1);
    expect(by("Maalik Hashi").minutes).toBe(0); // unused sub
  });
});

describe("player mapping", () => {
  const ars = bootstrap.elements.filter((e) => e.team === bootstrap.teams.find((t) => t.short_name === "ARS")!.id);
  it("matches accented and shortened names to the right FPL player", () => {
    expect(normalise("Martin Ødegaard")).toBe("martin odegaard");
    const raya = ars.find((e) => e.web_name === "Raya")!;
    expect(matchPlayer("David Raya", ars)).toBe(raya.id);
    const gab = ars.find((e) => e.web_name === "Gabriel")!;
    expect(matchPlayer("Gabriel Magalhães", ars)).toBe(gab.id);
  });
  it("returns null rather than guessing", () => {
    expect(matchPlayer("Some Academy Kid", ars)).toBeNull();
  });
});

describe("congestion", () => {
  const fx = (id: number, h: number, a: number, ko: string): Fixture => ({
    id, event: 8, team_h: h, team_a: a, team_h_score: null, team_a_score: null, team_h_difficulty: 3, team_a_difficulty: 3,
    kickoff_time: ko, started: false, finished: false, finished_provisional: false,
  });
  const index = {
    updatedAt: "",
    fixtures: [
      { eventId: "e1", comp: "uefa.champions" as const, date: "2026-10-21T19:00Z", completed: false, espnTeam: "359", opponent: "X", home: false, fplTeam: 1 },
      { eventId: "e2", comp: "eng.league_cup" as const, date: "2026-10-01T19:00Z", completed: true, espnTeam: "359", opponent: "Y", home: true, fplTeam: 1 },
    ],
  };
  it("cuts P(start) after a midweek European game, not after one 3 weeks earlier", () => {
    const m = congestionMultipliers(index, [fx(100, 1, 2, "2026-10-24T14:00Z"), fx(101, 1, 3, "2026-11-14T14:00Z")], new Set([8]));
    expect(m.get("1:100")).toBeCloseTo(1 - CONGESTION.europeBefore, 6);
    expect(m.has("1:101")).toBe(false);
    expect(m.has("2:100")).toBe(false); // opponent had no midweek game
  });
});

describe("all-comps form", () => {
  it("is bounded and neutral without evidence", () => {
    expect(formAdjustment(3, 540, 0, 0)).toBe(1);
    expect(formAdjustment(3, 540, 10, 180)).toBeLessThanOrEqual(1.1);
    expect(formAdjustment(3, 540, 0, 270)).toBeGreaterThanOrEqual(0.9);
    expect(formAdjustment(0.3, 540, 1, 180)).toBe(1); // low-xGI players are left alone
  });
});
