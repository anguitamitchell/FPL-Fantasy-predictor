import { revalidateTag } from "next/cache";
import { getBootstrap, getEventLive } from "@/lib/fpl/client";
import { ingestPriors } from "@/lib/data/priors";
import { writeSnapshot } from "@/lib/data/snapshots";
import { ingestExternal } from "@/lib/external/ingest";

export const maxDuration = 60;

/**
 * Daily ingest (Vercel Cron). Snapshots prices/ownership for trend tracking, stores settled
 * gameweek stats, tops up last-season priors and pulls other-competition data.
 * Auth: Vercel Cron sends `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const started = Date.now();
  const result: Record<string, unknown> = {};
  const b = await getBootstrap();

  const snap = await writeSnapshot(b);
  result.snapshot = { date: snap.date, players: Object.keys(snap.players).length };

  const settled = b.events.filter((e) => e.finished && e.data_checked);
  await Promise.all(settled.map((e) => getEventLive(e.id, true)));
  result.settledGws = settled.length;

  result.priors = await ingestPriors(b, 250);

  try {
    result.external = await ingestExternal(b);
  } catch (err) {
    result.external = { error: String(err) };
  }

  revalidateTag("app-data", "max");
  result.ms = Date.now() - started;
  return Response.json(result);
}
