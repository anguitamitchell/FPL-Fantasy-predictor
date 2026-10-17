import { getBootstrap } from "@/lib/fpl/client";
import { ingestPriors } from "@/lib/data/priors";

async function main() {
  const b = await getBootstrap();
  for (;;) {
    const r = await ingestPriors(b, 250);
    console.log(r);
    if (r.remaining === 0 || r.processed === 0) break;
  }
}
main();
