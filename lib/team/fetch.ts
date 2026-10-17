import { getBootstrap, getEntry, getEntryHistory, getEntryPicks, getEntryTransfers } from "@/lib/fpl/client";
import { buildImportedTeam, type ImportedTeam } from "./import";

export async function importTeam(entryId: number): Promise<ImportedTeam> {
  const bootstrap = await getBootstrap();
  const current = bootstrap.events.find((e) => e.is_current)?.id ?? 1;
  const nextGw = bootstrap.events.find((e) => e.is_next)?.id ?? current + 1;
  const [entry, history, transfers] = await Promise.all([getEntry(entryId), getEntryHistory(entryId), getEntryTransfers(entryId)]);
  let picksGw = Math.min(current, entry.current_event ?? current);
  let picks = await getEntryPicks(entryId, picksGw);
  // Free Hit squads revert: use the squad from the GW before.
  // Squad *and* bank revert to the pre-Free-Hit state.
  if (picks.active_chip === "freehit" && picksGw > 1) {
    picksGw -= 1;
    picks = { ...(await getEntryPicks(entryId, picksGw)), active_chip: "freehit" };
  }
  return buildImportedTeam({
    entryId,
    entry,
    picks,
    picksGw: picks.active_chip === "freehit" ? picksGw + 1 : picksGw,
    history,
    transfers,
    bootstrap,
    nextGw,
    maxBank: bootstrap.game_settings.max_extra_free_transfers + 1,
  });
}
