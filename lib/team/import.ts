import type { Bootstrap, EntryHistory, Picks, Transfers } from "@/lib/fpl/schemas";

export interface SquadSlot {
  id: number;
  purchase: number; // tenths
  sell: number; // tenths
  now: number; // tenths
}

export interface ImportedTeam {
  entryId: number;
  name: string;
  manager: string;
  overallRank: number | null;
  points: number | null;
  basedOnGw: number; // squad as of this GW's deadline
  squad: SquadSlot[];
  bank: number; // tenths
  freeTransfers: number;
  chipsAvailable: string[];
  activeChipLastGw: string | null;
  notes: string[];
}

/** FPL selling price: you keep half of any rise (rounded down to £0.1m); falls hit in full. */
export function sellingPrice(purchase: number, now: number): number {
  if (now <= purchase) return now;
  return purchase + Math.floor((now - purchase) / 2);
}

/**
 * Purchase price per currently-owned player: the most recent transfer in (ignoring Free Hit
 * weeks, whose transfers are reverted), else the GW1 price.
 */
export function purchasePrices(
  squad: number[],
  transfers: Transfers,
  history: EntryHistory,
  bootstrap: Bootstrap,
): Map<number, number> {
  const fhWeeks = new Set(history.chips.filter((c) => c.name === "freehit").map((c) => c.event));
  const byTime = [...transfers].filter((t) => !fhWeeks.has(t.event)).sort((a, b) => b.time.localeCompare(a.time));
  const el = new Map(bootstrap.elements.map((e) => [e.id, e]));
  const out = new Map<number, number>();
  for (const id of squad) {
    const t = byTime.find((x) => x.element_in === id);
    const e = el.get(id);
    out.set(id, t ? t.element_in_cost : e ? e.now_cost - e.cost_change_start : 0);
  }
  return out;
}

/**
 * Free transfers available for the next deadline. One per GW after GW1, banked up to
 * `maxBank`. Wildcard / Free Hit weeks keep the bank unchanged.
 */
export function freeTransfersAvailable(history: EntryHistory, maxBank = 5): number {
  const chipByGw = new Map(history.chips.map((c) => [c.event, c.name]));
  const rows = [...history.current].sort((a, b) => a.event - b.event);
  if (rows.length === 0) return 1;
  let ft = 0; // before the first GW deadline transfers are unlimited; start counting after
  for (const r of rows) {
    if (r === rows[0]) {
      ft = 1; // FT available for the following GW
      continue;
    }
    const chip = chipByGw.get(r.event);
    if (chip === "wildcard" || chip === "freehit") {
      ft = Math.min(maxBank, ft + 1);
      continue;
    }
    ft = Math.min(maxBank, Math.max(0, ft - r.event_transfers) + 1);
  }
  return ft;
}

/** Chips still available in the half of the season containing `gw`. */
export function chipsAvailable(bootstrap: Bootstrap, history: EntryHistory, gw: number): string[] {
  const out: string[] = [];
  for (const chip of bootstrap.chips) {
    if (gw < chip.start_event || gw > chip.stop_event) continue;
    const used = history.chips.some((c) => c.name === chip.name && c.event >= chip.start_event && c.event <= chip.stop_event);
    if (!used) out.push(chip.name);
  }
  return out;
}

export function buildImportedTeam(args: {
  entryId: number;
  entry: { name: string; player_first_name: string; player_last_name: string; summary_overall_rank: number | null; summary_overall_points: number | null };
  picks: Picks;
  picksGw: number;
  history: EntryHistory;
  transfers: Transfers;
  bootstrap: Bootstrap;
  nextGw: number;
  maxBank: number;
}): ImportedTeam {
  const { bootstrap, picks, history } = args;
  const ids = picks.picks.map((p) => p.element);
  const purchase = purchasePrices(ids, args.transfers, history, bootstrap);
  const now = new Map(bootstrap.elements.map((e) => [e.id, e.now_cost]));
  const squad = ids.map((id) => {
    const n = now.get(id) ?? 0;
    const pp = purchase.get(id) ?? n;
    return { id, purchase: pp, now: n, sell: sellingPrice(pp, n) };
  });
  const notes: string[] = [];
  notes.push(`Squad as of the GW${args.picksGw} deadline. Transfers made since then aren't public until the next deadline: edit below if needed.`);
  if (picks.active_chip === "freehit") notes.push("You played Free Hit last GW, so this is your squad from before it.");
  return {
    entryId: args.entryId,
    name: args.entry.name,
    manager: `${args.entry.player_first_name} ${args.entry.player_last_name}`,
    overallRank: args.entry.summary_overall_rank,
    points: args.entry.summary_overall_points,
    basedOnGw: args.picksGw,
    squad,
    bank: picks.entry_history.bank,
    freeTransfers: freeTransfersAvailable(history, args.maxBank),
    chipsAvailable: chipsAvailable(bootstrap, history, args.nextGw),
    activeChipLastGw: picks.active_chip,
    notes,
  };
}
