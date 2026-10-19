import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { z } from "zod";
import { kv as defaultKv, type KV } from "@/lib/store";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, keylen: number) => Promise<Buffer>;

/** What a cloud save holds. Prices are tenths of £m, like the FPL API. */
export const SavedTeamDataSchema = z.object({
  squad: z
    .array(
      z.object({
        id: z.number().int().positive(),
        sell: z.number().int().positive(),
        purchase: z.number().int().positive().optional(),
      }),
    )
    .max(15),
  bank: z.number().int().min(-1000).max(2000),
  freeTransfers: z.number().int().min(0).max(5),
  locked: z.array(z.number().int()).max(15).default([]),
  banned: z.array(z.number().int()).max(100).default([]),
  chips: z.array(z.string().max(20)).max(8).default([]),
  basedOnGw: z.number().int().nullable().optional(),
  teamName: z.string().max(80).optional(),
});
export type SavedTeamData = z.infer<typeof SavedTeamDataSchema>;

export const PinSchema = z.string().min(4, "PIN must be at least 4 characters").max(32, "PIN is too long");

interface StoredTeam {
  pin: { salt: string; hash: string };
  data: SavedTeamData;
  savedAt: string;
  fails?: { count: number; since: string };
}

export const MAX_FAILS = 8;
export const LOCKOUT_MS = 15 * 60_000;

export type SaveResult =
  | { ok: true; created: boolean; savedAt: string }
  | { ok: false; status: 403 | 429; error: string };
export type LoadResult =
  | { ok: true; data: SavedTeamData; savedAt: string }
  | { ok: false; status: 403 | 404 | 429; error: string };

const keyFor = (entryId: number) => `team:${entryId}`;

async function hashPin(pin: string, salt: Buffer) {
  return (await scrypt(pin, salt, 32)).toString("hex");
}

/** Checks the PIN, tracking failures so a short PIN can't be brute-forced. */
async function verify(rec: StoredTeam, pin: string, store: KV, key: string, now: Date): Promise<null | { status: 403 | 429; error: string }> {
  const fails = rec.fails;
  if (fails && fails.count >= MAX_FAILS && now.getTime() - new Date(fails.since).getTime() < LOCKOUT_MS) {
    return { status: 429, error: "Too many wrong PINs. Try again in 15 minutes." };
  }
  const hash = await hashPin(pin, Buffer.from(rec.pin.salt, "hex"));
  const ok = timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(rec.pin.hash, "hex"));
  if (ok) {
    if (fails) await store.set(key, { ...rec, fails: undefined });
    return null;
  }
  const expired = !fails || now.getTime() - new Date(fails.since).getTime() >= LOCKOUT_MS;
  const next = expired ? { count: 1, since: now.toISOString() } : { count: fails.count + 1, since: fails.since };
  await store.set(key, { ...rec, fails: next });
  return { status: 403, error: "Wrong PIN for this team ID." };
}

export async function savedTeamInfo(entryId: number, store: KV = defaultKv()) {
  const rec = await store.get<StoredTeam>(keyFor(entryId));
  return rec ? { exists: true as const, savedAt: rec.savedAt, teamName: rec.data.teamName ?? null } : { exists: false as const };
}

/** Creates a save (setting the PIN) or overwrites one (PIN must match). */
export async function saveTeam(entryId: number, pin: string, data: SavedTeamData, store: KV = defaultKv(), now = new Date()): Promise<SaveResult> {
  const key = keyFor(entryId);
  const existing = await store.get<StoredTeam>(key);
  if (existing) {
    const err = await verify(existing, pin, store, key, now);
    if (err) return { ok: false, ...err };
  }
  const salt = existing ? Buffer.from(existing.pin.salt, "hex") : randomBytes(16);
  const rec: StoredTeam = {
    pin: existing?.pin ?? { salt: salt.toString("hex"), hash: await hashPin(pin, salt) },
    data,
    savedAt: now.toISOString(),
  };
  await store.set(key, rec);
  return { ok: true, created: !existing, savedAt: rec.savedAt };
}

export async function loadTeam(entryId: number, pin: string, store: KV = defaultKv(), now = new Date()): Promise<LoadResult> {
  const key = keyFor(entryId);
  const rec = await store.get<StoredTeam>(key);
  if (!rec) return { ok: false, status: 404, error: "No saved team for this ID yet." };
  const err = await verify(rec, pin, store, key, now);
  if (err) return { ok: false, ...err };
  return { ok: true, data: rec.data, savedAt: rec.savedAt };
}
