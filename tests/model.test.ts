import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { BootstrapSchema, FixturesSchema, LiveSchema, type Fixture } from "@/lib/fpl/schemas";
import { expectedFloorDiv, negBinAtLeast, poissonAtLeast, poissonPmf } from "@/lib/model/poisson";
import { availability, parseReturnDate } from "@/lib/model/availability";
import { buildModel } from "@/lib/model/build";
import { projectFixture } from "@/lib/model/xpts";
import type { PlayerRates } from "@/lib/model/playerRates";

const load = (f: string) => JSON.parse(readFileSync(`tests/fixtures/${f}`, "utf8"));
const bootstrap = BootstrapSchema.parse(load("bootstrap-static.json"));
const fixtures = FixturesSchema.parse(load("fixtures.json"));
const live6 = LiveSchema.parse(load("event-6-live.json"));
const scoring = bootstrap.game_config.scoring;

describe("poisson helpers", () => {
  it("matches known values", () => {
    expect(poissonPmf(0, 1)).toBeCloseTo(Math.exp(-1), 10);
    expect(poissonAtLeast(1, 1.5)).toBeCloseTo(1 - Math.exp(-1.5), 10);
    // E[floor(X/2)] for lambda=2: sum_j P(X>=2j)
    const manual = [2, 4, 6, 8, 10, 12].reduce((s, k) => s + poissonAtLeast(k, 2), 0);
    expect(expectedFloorDiv(2, 2)).toBeCloseTo(manual, 6);
  });
  it("negative binomial is wider than poisson in the tails", () => {
    expect(negBinAtLeast(12, 6, 1.4)).toBeGreaterThan(poissonAtLeast(12, 6));
    expect(negBinAtLeast(12, 6, 1)).toBeCloseTo(poissonAtLeast(12, 6), 10);
  });
});

describe("availability", () => {
  const now = new Date("2026-10-16T12:00:00Z");
  it("uses chance of playing for doubtful players next GW, recovers later", () => {
    expect(availability({ status: "d", chance: 25, news: "" }, 0, now, now)).toBe(0.25);
    expect(availability({ status: "d", chance: 25, news: "" }, 2, now, now)).toBe(1);
  });
  it("honours a return date in the news", () => {
    expect(parseReturnDate("Hamstring injury - Expected back 25 Oct", now)?.getUTCDate()).toBe(25);
    const news = "Knee injury - Expected back 25 Oct";
    expect(availability({ status: "i", chance: 0, news }, 0, new Date("2026-10-17T10:00:00Z"), now)).toBe(0);
    expect(availability({ status: "i", chance: 0, news }, 2, new Date("2026-10-31T10:00:00Z"), now)).toBe(0.9);
  });
  it("treats unavailable players as out", () => {
    expect(availability({ status: "u", chance: null, news: "" }, 3, now, now)).toBe(0);
  });
});

const rates: PlayerRates = {
  xg90: 0.5, xa90: 0.2, goals90: 0.5, assists90: 0.2, bonus90: 0.5, saves90: 3, dc90: 10, yellow90: 0.1,
  dcHitRate: null, dcFullMatches: 0, startRate: 1, subRate: 0, minsIfStart: 90, minsIfSub: 20, p60IfStart: 1, seasonMinutes: 900,
};
const ctx = { gw: 7, fixtureId: 1, opponent: 2, home: true, lambdaFor: 1.5, lambdaAgainst: 1.0, teamAvgFor: 1.5, teamAvgAgainst: 1.0, availability: 1 };

describe("fixture projection follows FPL scoring", () => {
  it("values goals by position", () => {
    const fwd = projectFixture("FWD", rates, ctx, scoring);
    const mid = projectFixture("MID", rates, ctx, scoring);
    expect(fwd.components.goals / mid.components.goals).toBeCloseTo(4 / 5, 6);
    expect(fwd.components.appearance).toBeCloseTo(2, 6); // starts and plays 90
  });
  it("clean sheet = P(0 conceded) x CS points; forwards get none", () => {
    expect(projectFixture("DEF", rates, ctx, scoring).components.cleanSheet).toBeCloseTo(Math.exp(-1) * 4, 6);
    expect(projectFixture("FWD", rates, ctx, scoring).components.cleanSheet).toBe(0);
  });
  it("defensive contribution: 2 pts x P(>= threshold); GKs get none", () => {
    const def = projectFixture("DEF", rates, ctx, scoring);
    expect(def.components.defCon).toBeCloseTo(2 * negBinAtLeast(10, 10, 1.4), 6);
    expect(projectFixture("GKP", rates, ctx, scoring).components.defCon).toBe(0);
  });
  it("unavailable player projects zero", () => {
    expect(projectFixture("MID", rates, { ...ctx, availability: 0 }, scoring).xpts).toBeCloseTo(0, 6);
  });
});

describe("buildModel", () => {
  const lives = new Map([[6, live6]]);
  const base = { bootstrap, lives, priors: new Map(), now: new Date("2026-10-16T12:00:00Z"), horizon: 1, startGw: 7 };

  it("sums both fixtures in a double gameweek and gives 0 in a blank", () => {
    const haaland = bootstrap.elements.find((e) => e.web_name === "Haaland")!;
    const gw7 = fixtures.filter((f) => f.event === 7);
    const mciFixture = gw7.find((f) => f.team_h === haaland.team || f.team_a === haaland.team)!;
    const single = buildModel({ ...base, fixtures }).players.get(haaland.id)!;
    // Add a second GW7 fixture for City -> double GW
    const extra: Fixture = { ...mciFixture, id: 9999 };
    const dgw = buildModel({ ...base, fixtures: [...fixtures, extra] }).players.get(haaland.id)!;
    expect(dgw.fixtures).toHaveLength(2);
    expect(dgw.byGw[7]).toBeCloseTo(single.byGw[7] * 2, 1);
    // Remove City's GW7 fixture -> blank
    const blank = buildModel({ ...base, fixtures: fixtures.filter((f) => f.id !== mciFixture.id) }).players.get(haaland.id)!;
    expect(blank.byGw[7]).toBe(0);
  });
  it("projects sensible totals", () => {
    const m = buildModel({ ...base, fixtures });
    const vals = [...m.players.values()].map((p) => p.byGw[7]);
    expect(Math.max(...vals)).toBeLessThan(15);
    expect(Math.min(...vals)).toBeGreaterThanOrEqual(-1);
  });
});
