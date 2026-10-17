import { getBootstrap, getEventLive, getFixtures } from "@/lib/fpl/client";
import type { Bootstrap, Fixture, Live } from "@/lib/fpl/schemas";
import { buildModel, type ModelOutput } from "@/lib/model/build";
import { loadPriors } from "./priors";

export interface SeasonData {
  bootstrap: Bootstrap;
  fixtures: Fixture[];
  lives: Map<number, Live>;
}

/** Bootstrap + fixtures + per-GW live stats for every finished gameweek. */
export async function loadSeason(): Promise<SeasonData> {
  const [bootstrap, fixtures] = await Promise.all([getBootstrap(), getFixtures()]);
  const finished = bootstrap.events.filter((e) => e.finished);
  const lives = new Map<number, Live>();
  await Promise.all(
    finished.map(async (e) => {
      lives.set(e.id, await getEventLive(e.id, e.data_checked));
    }),
  );
  return { bootstrap, fixtures, lives };
}

export async function runModel(horizon = 5, extra: Partial<Parameters<typeof buildModel>[0]> = {}): Promise<ModelOutput & SeasonData> {
  const season = await loadSeason();
  const priors = await loadPriors(season.bootstrap);
  const model = buildModel({ ...season, priors, now: new Date(), horizon, ...extra });
  return { ...model, ...season };
}
