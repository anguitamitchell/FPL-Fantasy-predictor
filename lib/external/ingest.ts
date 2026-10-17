import type { Bootstrap } from "@/lib/fpl/schemas";

/** Placeholder until other-competition data is wired up (Step 4). */
export async function ingestExternal(_b: Bootstrap) {
  return { skipped: "API_FOOTBALL_KEY not set" };
}
