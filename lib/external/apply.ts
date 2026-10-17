import type { PlayerRow } from "@/lib/data/view";

export interface ExternalAdjustments {
  minutesMultipliers?: Map<string, number>;
  attackAdjust?: Map<number, number>;
  info?: Map<number, PlayerRow["ext"]>;
}

/** Placeholder until other-competition data is wired up (Step 4). */
export async function loadExternal(): Promise<ExternalAdjustments> {
  return {};
}
