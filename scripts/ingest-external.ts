import { getBootstrap } from "@/lib/fpl/client";
import { ingestExternal } from "@/lib/external/ingest";

getBootstrap().then(async (b) => {
  for (let i = 0; i < 5; i++) {
    const r = await ingestExternal(b, 60);
    console.log(JSON.stringify(r, null, 1));
    if (!("pendingSummaries" in r) || r.pendingSummaries === 0) break;
  }
});
