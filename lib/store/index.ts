import { promises as fs } from "fs";
import path from "path";

/**
 * Tiny key/value store. Locally it writes JSON files under `.data/`; when
 * SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set it uses a `kv` table via PostgREST.
 */
export interface KV {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
  list(prefix: string): Promise<string[]>;
}

// Vercel functions can only write to /tmp; production should set SUPABASE_URL instead.
const DATA_DIR = process.env.VERCEL ? "/tmp/.data" : path.join(process.cwd(), ".data");
const fileFor = (key: string) => path.join(DATA_DIR, encodeURIComponent(key) + ".json");

const localStore: KV = {
  async get<T>(key: string) {
    try {
      return JSON.parse(await fs.readFile(fileFor(key), "utf8")) as T;
    } catch {
      return null;
    }
  },
  async set(key, value) {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const tmp = fileFor(key) + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(value));
    await fs.rename(tmp, fileFor(key));
  },
  async list(prefix) {
    try {
      const files = await fs.readdir(DATA_DIR);
      return files
        .filter((f) => f.endsWith(".json"))
        .map((f) => decodeURIComponent(f.slice(0, -5)))
        .filter((k) => k.startsWith(prefix))
        .sort();
    } catch {
      return [];
    }
  },
};

function supabaseStore(url: string, serviceKey: string): KV {
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };
  const rest = `${url.replace(/\/$/, "")}/rest/v1/kv`;
  return {
    async get<T>(key: string) {
      const res = await fetch(`${rest}?key=eq.${encodeURIComponent(key)}&select=value`, { headers, cache: "no-store" });
      if (!res.ok) throw new Error(`kv get ${key}: ${res.status} ${await res.text()}`);
      const rows = (await res.json()) as { value: T }[];
      return rows[0]?.value ?? null;
    },
    async set(key, value) {
      const res = await fetch(rest, {
        method: "POST",
        headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }),
      });
      if (!res.ok) throw new Error(`kv set ${key}: ${res.status} ${await res.text()}`);
    },
    async list(prefix) {
      const like = encodeURIComponent(prefix.replace(/[%_]/g, "\\$&") + "%");
      const res = await fetch(`${rest}?key=like.${like}&select=key&order=key`, { headers, cache: "no-store" });
      if (!res.ok) throw new Error(`kv list ${prefix}: ${res.status} ${await res.text()}`);
      return ((await res.json()) as { key: string }[]).map((r) => r.key);
    },
  };
}

let cached: KV | null = null;
export function kv(): KV {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  cached = url && key ? supabaseStore(url, key) : localStore;
  return cached;
}
