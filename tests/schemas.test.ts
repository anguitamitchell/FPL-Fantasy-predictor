import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import {
  BootstrapSchema,
  EntryHistorySchema,
  EntrySchema,
  FixturesSchema,
  LiveSchema,
  PicksSchema,
  TransfersSchema,
} from "@/lib/fpl/schemas";

const load = (f: string) => JSON.parse(readFileSync(`tests/fixtures/${f}`, "utf8"));

describe("FPL schemas parse real samples", () => {
  it("bootstrap-static", () => {
    const b = BootstrapSchema.parse(load("bootstrap-static.json"));
    expect(b.elements.length).toBeGreaterThan(500);
    expect(b.teams).toHaveLength(20);
    expect(typeof b.elements[0].form).toBe("number");
    expect(b.game_config.scoring.goals_scored.MID).toBe(5);
  });
  it("fixtures", () => expect(FixturesSchema.parse(load("fixtures.json"))).toHaveLength(380));
  it("event live", () => expect(LiveSchema.parse(load("event-6-live.json")).elements.length).toBeGreaterThan(500));
  it("entry endpoints", () => {
    expect(PicksSchema.parse(load("entry-1-picks-6.json")).picks).toHaveLength(15);
    expect(EntryHistorySchema.parse(load("entry-1-history.json")).current.length).toBeGreaterThan(0);
    expect(TransfersSchema.parse(load("entry-1-transfers.json")).length).toBeGreaterThan(0);
    expect(EntrySchema.parse(load("entry-1.json")).id).toBe(1);
  });
});
