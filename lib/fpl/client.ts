import { z } from "zod";
import { kv } from "@/lib/store";
import {
  BootstrapSchema,
  EntryHistorySchema,
  EntrySchema,
  FixturesSchema,
  LiveSchema,
  PicksSchema,
  TransfersSchema,
  type Bootstrap,
  type Fixture,
  type Live,
} from "./schemas";

const BASE = "https://fantasy.premierleague.com/api";
const UA = "Mozilla/5.0 (compatible; fpl-predictor/2.0)";

export class FplError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

async function fetchRaw(path: string, attempts = 3): Promise<unknown> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${BASE}${path}`, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 404) throw new FplError(`Not found: ${path}`, 404);
      if (!res.ok) throw new FplError(`FPL ${res.status} for ${path}`, res.status);
      // During gameweek updates FPL serves an HTML "The game is being updated" page.
      const text = await res.text();
      if (text.startsWith("<")) throw new FplError("FPL is updating; try again shortly", 503);
      return JSON.parse(text);
    } catch (err) {
      lastErr = err;
      if (err instanceof FplError && err.status === 404) throw err;
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw lastErr;
}

type MemEntry = { at: number; value: unknown };
const mem = new Map<string, MemEntry>();
const inflight = new Map<string, Promise<unknown>>();

/**
 * Fetch + validate with: in-memory TTL cache, request de-duplication, and a
 * persisted last-good copy used when FPL is unreachable (stale-if-error).
 */
async function cachedGet<S extends z.ZodTypeAny>(
  path: string,
  schema: S,
  ttlMs: number,
  opts: { persist?: boolean } = {},
): Promise<z.infer<S>> {
  const hit = mem.get(path);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as z.infer<S>;
  const pending = inflight.get(path);
  if (pending) return pending as Promise<z.infer<S>>;

  const p = (async () => {
    const storeKey = `fpl:${path}`;
    try {
      const value = schema.parse(await fetchRaw(path));
      mem.set(path, { at: Date.now(), value });
      if (opts.persist) await kv().set(storeKey, value).catch(() => {});
      return value;
    } catch (err) {
      if (opts.persist && !(err instanceof FplError && err.status === 404)) {
        const stale = await kv().get<z.infer<S>>(storeKey).catch(() => null);
        if (stale) {
          mem.set(path, { at: Date.now() - ttlMs / 2, value: stale });
          return stale;
        }
      }
      throw err;
    } finally {
      inflight.delete(path);
    }
  })();
  inflight.set(path, p);
  return p;
}

const TEN_MIN = 10 * 60_000;

export const getBootstrap = (): Promise<Bootstrap> =>
  cachedGet("/bootstrap-static/", BootstrapSchema, TEN_MIN, { persist: true });

export const getFixtures = (): Promise<Fixture[]> =>
  cachedGet("/fixtures/", FixturesSchema, TEN_MIN, { persist: true });

/**
 * Per-gameweek stats for every player. Once a GW is finished and data_checked,
 * it never changes, so it is stored permanently and never re-fetched.
 */
export async function getEventLive(gw: number, settled: boolean): Promise<Live> {
  const key = `fpl:live:${gw}`;
  if (settled) {
    const stored = await kv().get<Live>(key).catch(() => null);
    if (stored) return stored;
  }
  const live = await cachedGet(`/event/${gw}/live/`, LiveSchema, settled ? Infinity : TEN_MIN);
  if (settled) await kv().set(key, live).catch(() => {});
  return live;
}

export const getEntry = (id: number) => cachedGet(`/entry/${id}/`, EntrySchema, 60_000);
export const getEntryPicks = (id: number, gw: number) =>
  cachedGet(`/entry/${id}/event/${gw}/picks/`, PicksSchema, 60_000);
export const getEntryHistory = (id: number) => cachedGet(`/entry/${id}/history/`, EntryHistorySchema, 60_000);
export const getEntryTransfers = (id: number) => cachedGet(`/entry/${id}/transfers/`, TransfersSchema, 60_000);
