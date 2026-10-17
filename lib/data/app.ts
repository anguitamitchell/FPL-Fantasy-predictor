import { cacheLife, cacheTag } from "next/cache";
import { runModel } from "./season";
import { toAppData, type AppData } from "./view";
import { loadExternal } from "@/lib/external/apply";

export const HORIZON = 5;

/** Model output for the whole app, cached for 10 minutes (FPL data changes slowly). */
export async function getAppData(): Promise<AppData> {
  "use cache";
  cacheLife({ stale: 300, revalidate: 600, expire: 3600 });
  cacheTag("app-data");
  const ext = await loadExternal();
  const m = await runModel(HORIZON, { minutesMultipliers: ext.minutesMultipliers, attackAdjust: ext.attackAdjust });
  return toAppData(m, ext.info);
}
