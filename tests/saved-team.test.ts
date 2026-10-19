import { describe, expect, it } from "vitest";
import type { KV } from "@/lib/store";
import { LOCKOUT_MS, MAX_FAILS, loadTeam, savedTeamInfo, saveTeam, type SavedTeamData } from "@/lib/team/saved";

function memoryKv(): KV & { raw: Map<string, unknown> } {
  const raw = new Map<string, unknown>();
  return {
    raw,
    async get<T>(k: string) {
      return (raw.has(k) ? structuredClone(raw.get(k)) : null) as T | null;
    },
    async set(k, v) {
      raw.set(k, structuredClone(v));
    },
    async list(p) {
      return [...raw.keys()].filter((k) => k.startsWith(p));
    },
  };
}

const data: SavedTeamData = {
  squad: [{ id: 1, sell: 50, purchase: 50 }],
  bank: 5,
  freeTransfers: 2,
  locked: [1],
  banned: [],
  chips: ["wildcard"],
};

describe("cloud-saved teams", () => {
  it("creates a save, then loads it with the right PIN", async () => {
    const kv = memoryKv();
    expect(await savedTeamInfo(42, kv)).toEqual({ exists: false });
    const s = await saveTeam(42, "1234", data, kv);
    expect(s).toMatchObject({ ok: true, created: true });
    expect((await savedTeamInfo(42, kv)).exists).toBe(true);
    const l = await loadTeam(42, "1234", kv);
    expect(l.ok && l.data).toEqual(data);
  });

  it("never stores the PIN in plain text", async () => {
    const kv = memoryKv();
    await saveTeam(42, "secret-pin", data, kv);
    expect(JSON.stringify(kv.raw.get("team:42"))).not.toContain("secret-pin");
  });

  it("rejects a wrong PIN for load and overwrite", async () => {
    const kv = memoryKv();
    await saveTeam(42, "1234", data, kv);
    expect(await loadTeam(42, "9999", kv)).toMatchObject({ ok: false, status: 403 });
    expect(await saveTeam(42, "9999", { ...data, bank: 0 }, kv)).toMatchObject({ ok: false, status: 403 });
    const l = await loadTeam(42, "1234", kv);
    expect(l.ok && l.data.bank).toBe(5); // not overwritten
  });

  it("locks out after repeated wrong PINs, then recovers", async () => {
    const kv = memoryKv();
    const t0 = new Date("2026-10-19T12:00:00Z");
    await saveTeam(42, "1234", data, kv, t0);
    for (let i = 0; i < MAX_FAILS; i++) await loadTeam(42, "0000", kv, t0);
    // Even the right PIN is refused during the lockout
    expect(await loadTeam(42, "1234", kv, t0)).toMatchObject({ ok: false, status: 429 });
    const later = new Date(t0.getTime() + LOCKOUT_MS + 1000);
    expect((await loadTeam(42, "1234", kv, later)).ok).toBe(true);
  });

  it("returns 404 when nothing is saved", async () => {
    expect(await loadTeam(7, "1234", memoryKv())).toMatchObject({ ok: false, status: 404 });
  });
});
