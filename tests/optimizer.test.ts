import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { BootstrapSchema, EntryHistorySchema, FixturesSchema, LiveSchema, PicksSchema, TransfersSchema } from "@/lib/fpl/schemas";
import { buildModel } from "@/lib/model/build";
import { optimise, prunePool, type OptPlayer } from "@/lib/optimizer/squad";
import { buildImportedTeam, freeTransfersAvailable, sellingPrice } from "@/lib/team/import";

const load = (f: string) => JSON.parse(readFileSync(`tests/fixtures/${f}`, "utf8"));
const bootstrap = BootstrapSchema.parse(load("bootstrap-static.json"));
const fixtures = FixturesSchema.parse(load("fixtures.json"));
const model = buildModel({
  bootstrap,
  fixtures,
  lives: new Map([[6, LiveSchema.parse(load("event-6-live.json"))]]),
  priors: new Map(),
  now: new Date("2026-10-16T12:00:00Z"),
  horizon: 3,
  startGw: 7,
});
const all: OptPlayer[] = [...model.players.values()].map((p) => ({
  id: p.element.id,
  pos: p.pos,
  team: p.element.team,
  price: p.element.now_cost,
  xp: model.gws.map((g) => p.byGw[g]),
}));
const team = buildImportedTeam({
  entryId: 1,
  entry: { name: "t", player_first_name: "a", player_last_name: "b", summary_overall_rank: 1, summary_overall_points: 1 },
  picks: PicksSchema.parse(load("entry-1-picks-6.json")),
  picksGw: 6,
  history: EntryHistorySchema.parse(load("entry-1-history.json")),
  transfers: TransfersSchema.parse(load("entry-1-transfers.json")),
  bootstrap,
  nextGw: 7,
  maxBank: 5,
});
const owned = team.squad.map((s) => ({ id: s.id, sell: s.sell }));
const pool = prunePool(all, new Set(owned.map((o) => o.id)));
const byId = new Map(all.map((p) => [p.id, p]));

function assertValid(squad: number[], bankAfter: number) {
  expect(squad).toHaveLength(15);
  const count = (pos: string) => squad.filter((id) => byId.get(id)!.pos === pos).length;
  expect([count("GKP"), count("DEF"), count("MID"), count("FWD")]).toEqual([2, 5, 5, 3]);
  const clubs = new Map<number, number>();
  for (const id of squad) clubs.set(byId.get(id)!.team, (clubs.get(byId.get(id)!.team) ?? 0) + 1);
  expect(Math.max(...clubs.values())).toBeLessThanOrEqual(3);
  expect(bankAfter).toBeGreaterThanOrEqual(0);
}

describe("team import", () => {
  it("selling price keeps half of a rise, rounded down", () => {
    expect(sellingPrice(56, 59)).toBe(57);
    expect(sellingPrice(56, 57)).toBe(56);
    expect(sellingPrice(56, 54)).toBe(54);
  });
  it("imports 15 players with bank and FT from the real sample", () => {
    expect(team.squad).toHaveLength(15);
    expect(team.bank).toBe(1);
    expect(team.freeTransfers).toBeGreaterThanOrEqual(1);
    expect(team.freeTransfers).toBeLessThanOrEqual(5);
  });
  it("free transfers: +1 per GW, used transfers consumed, capped", () => {
    const h = (rows: [number, number][], chips: { name: string; event: number }[] = []) =>
      EntryHistorySchema.parse({
        current: rows.map(([event, t]) => ({ event, points: 0, total_points: 0, overall_rank: 1, bank: 0, value: 1000, event_transfers: t, event_transfers_cost: 0, points_on_bench: 0 })),
        chips: chips.map((c) => ({ ...c, time: "" })),
      });
    expect(freeTransfersAvailable(h([[1, 0]]))).toBe(1);
    expect(freeTransfersAvailable(h([[1, 0], [2, 0]]))).toBe(2);
    expect(freeTransfersAvailable(h([[1, 0], [2, 3]]))).toBe(1); // took a hit
    expect(freeTransfersAvailable(h([[1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0], [7, 0]]))).toBe(5);
  });
});

describe("optimizer", () => {
  it("every scenario produces a legal squad and lineup", async () => {
    for (const k of [0, 1, 2]) {
      const r = await optimise({ pool, owned, bank: team.bank, freeTransfers: 1, exactTransfers: k });
      expect(r.status).toBe("Optimal");
      assertValid(r.squad, r.bankAfter);
      expect(r.transfersIn).toHaveLength(k);
      expect(r.hits).toBe(Math.max(0, k - 1));
      for (const l of r.lineups) {
        expect(l.starters).toHaveLength(11);
        expect(l.starters).toContain(l.captain);
        expect(l.starters.filter((id) => byId.get(id)!.pos === "GKP")).toHaveLength(1);
        expect(l.starters.filter((id) => byId.get(id)!.pos === "DEF").length).toBeGreaterThanOrEqual(3);
      }
    }
  });
  it("with 0 FT, only takes a hit when it gains more than 4 points", async () => {
    const hold = await optimise({ pool, owned, bank: team.bank, freeTransfers: 0, exactTransfers: 0 });
    const free = await optimise({ pool, owned, bank: team.bank, freeTransfers: 0, maxTransfers: 3 });
    if (free.transfersIn.length > 0) expect(free.netPoints - hold.netPoints).toBeGreaterThan(0);
    expect(free.objective).toBeGreaterThanOrEqual(hold.objective - 1e-6);
  });
  it("respects locks and bans", async () => {
    const target = pool.filter((p) => p.pos === "MID" && !owned.some((o) => o.id === p.id)).sort((a, b) => b.xp[0] - a.xp[0])[1];
    const r = await optimise({ pool, owned, bank: 200, freeTransfers: 2, maxTransfers: 2, locked: [target.id] });
    expect(r.squad).toContain(target.id);
    const r2 = await optimise({ pool, owned, bank: 200, freeTransfers: 2, maxTransfers: 2, banned: [target.id] });
    expect(r2.squad).not.toContain(target.id);
  });
});
