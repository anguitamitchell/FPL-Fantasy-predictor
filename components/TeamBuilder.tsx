"use client";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { FixtureCell } from "@/lib/data/view";
import type { Scenario } from "@/lib/optimizer/scenarios";
import type { ImportedTeam } from "@/lib/team/import";
import { FixtureChip, StatusDot, fmt } from "./ui";

export interface SlimPlayer {
  id: number;
  name: string;
  team: number;
  teamShort: string;
  pos: "GKP" | "DEF" | "MID" | "FWD";
  price: number;
  ownership: number;
  xpts: number;
  byGw: number[];
  status: string;
  chance: number | null;
  news: string;
  fixtures: FixtureCell[];
  inactive: boolean;
}

type Slot = { id: number; sell: number }; // sell in tenths
const POSITIONS = ["GKP", "DEF", "MID", "FWD"] as const;
const LIMITS = { GKP: 2, DEF: 5, MID: 5, FWD: 3 };
const STORAGE_KEY = "fpl-predictor:team";

type Stored = { entryId?: string; squad?: Slot[]; bank?: number; ft?: number };
function readStorage(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
const noopSubscribe = () => () => {};
function writeStorage(v: object) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
  } catch {}
}

/** Restores the last squad from localStorage after hydration (remounts once with it). */
export function TeamBuilder(props: { players: SlimPlayer[]; gws: number[] }) {
  const raw = useSyncExternalStore(noopSubscribe, readStorage, () => undefined);
  if (raw === undefined) return <Builder key="ssr" {...props} initial={null} />;
  let initial: Stored | null = null;
  try {
    initial = raw ? (JSON.parse(raw) as Stored) : null;
  } catch {}
  return <Builder key="client" {...props} initial={initial} />;
}

function Builder({ players, gws, initial }: { players: SlimPlayer[]; gws: number[]; initial: Stored | null }) {
  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const restorable = !!initial?.squad?.length && initial.squad.every((x) => byId.has(x.id));
  const [entryId, setEntryId] = useState(initial?.entryId ?? "");
  const [team, setTeam] = useState<ImportedTeam | null>(null);
  const [squad, setSquad] = useState<Slot[]>(restorable ? initial!.squad! : []);
  const [bank, setBank] = useState(restorable ? (initial!.bank ?? 0) : 0); // tenths
  const [ft, setFt] = useState(restorable ? (initial!.ft ?? 1) : 1);
  const [chips, setChips] = useState<string[]>([]);
  const [useChips, setUseChips] = useState<string[]>([]);
  const [locked, setLocked] = useState<number[]>([]);
  const [banned, setBanned] = useState<number[]>([]);
  const [maxHits, setMaxHits] = useState(1);
  const [loading, setLoading] = useState<"import" | "opt" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<{ scenarios: Scenario[]; advice: string } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [replacing, setReplacing] = useState<{ index: number | null; pos: SlimPlayer["pos"] } | null>(null);
  const [started, setStarted] = useState(restorable);
  useEffect(() => {
    if (squad.length) writeStorage({ entryId, squad, bank, ft });
  }, [entryId, squad, bank, ft]);

  async function importById() {
    const id = entryId.trim();
    if (!/^\d+$/.test(id)) return setError("Enter the numeric team ID from your FPL points page URL.");
    setLoading("import");
    setError(null);
    setPlan(null);
    try {
      const res = await fetch(`/api/team/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Import failed");
      const t = data as ImportedTeam;
      setTeam(t);
      setSquad(t.squad.map((s) => ({ id: s.id, sell: s.sell })));
      setBank(t.bank);
      setFt(t.freeTransfers);
      setChips(t.chipsAvailable);
      setUseChips([]);
      setLocked([]);
      setStarted(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(null);
    }
  }

  function startEmpty() {
    setTeam(null);
    setSquad([]);
    setBank(1000);
    setFt(1);
    setChips([]);
    setPlan(null);
    setStarted(true);
  }

  async function optimiseNow() {
    setLoading("opt");
    setError(null);
    try {
      const res = await fetch("/api/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ squad, bank, freeTransfers: ft, locked, banned, chips: useChips, maxHits }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Optimisation failed");
      setPlan(data);
      setSelected(data.scenarios.find((s: Scenario) => s.recommended)?.key ?? data.scenarios[0]?.key ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(null);
    }
  }

  const scenario = plan?.scenarios.find((s) => s.key === selected) ?? null;
  // What the pitch shows: the selected scenario's squad, or the current one.
  const shownIds = scenario ? scenario.result.squad : squad.map((s) => s.id);
  const lineup = scenario?.result.lineups[0];
  const incoming = new Set(scenario?.result.transfersIn ?? []);

  function applyScenario(s: Scenario) {
    const sellOf = new Map(squad.map((x) => [x.id, x.sell]));
    setSquad(s.result.squad.map((id) => ({ id, sell: sellOf.get(id) ?? Math.round(byId.get(id)!.price * 10) })));
    setBank(s.result.bankAfter);
    const used = s.result.transfersIn.length;
    if (s.key !== "wildcard" && s.key !== "freehit" && s.key !== "complete") setFt(Math.max(0, ft - used));
    setPlan(null);
    setSelected(null);
  }

  function replace(index: number | null, newId: number) {
    const p = byId.get(newId)!;
    const next = [...squad];
    let credit = 0;
    if (index !== null) {
      credit = next[index].sell;
      next[index] = { id: newId, sell: Math.round(p.price * 10) };
    } else next.push({ id: newId, sell: Math.round(p.price * 10) });
    setSquad(next);
    setBank(bank + credit - Math.round(p.price * 10));
    setPlan(null);
    setReplacing(null);
  }
  function removeAt(index: number) {
    setBank(bank + squad[index].sell);
    setSquad(squad.filter((_, i) => i !== index));
    setPlan(null);
  }

  const counts = Object.fromEntries(POSITIONS.map((p) => [p, squad.filter((s) => byId.get(s.id)?.pos === p).length]));
  const clubCount = new Map<number, number>();
  for (const s of squad) {
    const t = byId.get(s.id)?.team;
    if (t !== undefined) clubCount.set(t, (clubCount.get(t) ?? 0) + 1);
  }
  const squadXp = squad.reduce((acc, s) => acc + (byId.get(s.id)?.byGw[0] ?? 0), 0);

  return (
    <div className="space-y-5">
      {/* Import */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-surface p-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">FPL team ID</span>
          <input
            value={entryId}
            onChange={(e) => setEntryId(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && importById()}
            inputMode="numeric"
            placeholder="e.g. 1234567"
            className="w-40 rounded-lg border border-border bg-bg px-3 py-2"
          />
        </label>
        <button onClick={importById} disabled={loading !== null} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-text disabled:opacity-50">
          {loading === "import" ? "Loading…" : "Import team"}
        </button>
        <button onClick={startEmpty} className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-surface-2">Build from scratch</button>
        <p className="basis-full text-xs text-muted sm:basis-auto">
          Your ID is the number in your Points page URL: fantasy.premierleague.com/entry/<b>1234567</b>/event/6
        </p>
      </div>

      {error && <div className="rounded-lg border border-bad/40 bg-bad/10 px-4 py-3 text-sm text-bad">{error}</div>}

      {team && (
        <div className="rounded-xl border border-border bg-surface px-4 py-3 text-sm">
          <div className="font-medium">
            {team.name} <span className="font-normal text-muted">· {team.manager}{team.overallRank ? ` · rank ${team.overallRank.toLocaleString()}` : ""}</span>
          </div>
          {team.notes.map((n, i) => <p key={i} className="mt-1 text-xs text-muted">{n}</p>)}
        </div>
      )}

      {started && (
        <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
          <div className="space-y-4">
            {/* Settings */}
            <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-surface p-3 text-sm">
              <label className="flex items-center gap-2">
                <span className="text-muted">Bank £</span>
                <input
                  type="number"
                  step={0.1}
                  value={(bank / 10).toFixed(1)}
                  onChange={(e) => setBank(Math.round(Number(e.target.value) * 10))}
                  className="w-20 rounded-lg border border-border bg-bg px-2 py-1.5 tabular"
                />
              </label>
              <label className="flex items-center gap-2">
                <span className="text-muted">Free transfers</span>
                <select value={ft} onChange={(e) => setFt(Number(e.target.value))} className="rounded-lg border border-border bg-bg px-2 py-1.5">
                  {[0, 1, 2, 3, 4, 5].map((v) => <option key={v}>{v}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-2">
                <span className="text-muted">Max hits</span>
                <select value={maxHits} onChange={(e) => setMaxHits(Number(e.target.value))} className="rounded-lg border border-border bg-bg px-2 py-1.5">
                  {[0, 1, 2].map((v) => <option key={v}>{v}</option>)}
                </select>
              </label>
              {chips.filter((c) => c === "wildcard" || c === "freehit").map((c) => (
                <label key={c} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={useChips.includes(c)}
                    onChange={(e) => setUseChips(e.target.checked ? [...useChips, c] : useChips.filter((x) => x !== c))}
                    className="accent-[var(--accent)]"
                  />
                  Try {c === "wildcard" ? "Wildcard" : "Free Hit"}
                </label>
              ))}
              <span className="ml-auto text-xs text-muted">
                {squad.length}/15 · GW{gws[0]} xPts (all 15): <span className="tabular font-medium text-text">{squadXp.toFixed(1)}</span>
              </span>
            </div>

            {/* Pitch */}
            <Pitch
              ids={shownIds}
              byId={byId}
              lineup={lineup}
              incoming={incoming}
              locked={locked}
              banned={banned}
              editable={!scenario}
              squad={squad}
              counts={counts}
              gwLabel={`GW${gws[0]}`}
              onReplace={(index, pos) => setReplacing({ index, pos })}
              onRemove={removeAt}
              onToggleLock={(id) => setLocked(locked.includes(id) ? locked.filter((x) => x !== id) : [...locked, id])}
              onToggleBan={(id) => setBanned(banned.includes(id) ? banned.filter((x) => x !== id) : [...banned, id])}
            />
            {scenario && (
              <p className="text-center text-xs text-muted">
                Previewing “{scenario.title}”. New players are highlighted.{" "}
                <button className="underline" onClick={() => setSelected(null)}>Back to my squad</button>
              </p>
            )}
            {[...clubCount.entries()].some(([, n]) => n > 3) && (
              <p className="text-sm text-bad">More than 3 players from one club: the optimiser will reject this squad.</p>
            )}
          </div>

          {/* Plan */}
          <div className="space-y-3">
            <button
              onClick={optimiseNow}
              disabled={loading !== null || (squad.length === 15 && Object.entries(LIMITS).some(([p, n]) => counts[p] !== n))}
              className="w-full rounded-xl bg-accent px-4 py-3 font-medium text-accent-text disabled:opacity-50"
            >
              {loading === "opt" ? "Optimising…" : squad.length < 15 ? `Fill ${15 - squad.length} empty slot${squad.length === 14 ? "" : "s"} optimally` : "Suggest transfers"}
            </button>
            {(locked.length > 0 || banned.length > 0) && (
              <p className="text-xs text-muted">
                {locked.length} locked · {banned.length} excluded{" "}
                <button className="underline" onClick={() => { setLocked([]); setBanned([]); }}>clear</button>
              </p>
            )}
            {plan && (
              <>
                <div className="rounded-xl border border-accent/40 bg-accent-soft px-4 py-3 text-sm">{plan.advice}</div>
                {plan.scenarios.map((s) => (
                  <ScenarioCard
                    key={s.key}
                    s={s}
                    byId={byId}
                    active={selected === s.key}
                    onSelect={() => setSelected(selected === s.key ? null : s.key)}
                    onApply={() => applyScenario(s)}
                  />
                ))}
                <p className="text-xs text-muted">
                  Gains are expected points over GW{gws[0]}–{gws[gws.length - 1]} for your best XI + captain each week, with later weeks weighted
                  less. Recommendations demand an extra 2 points per hit and value a rolled transfer at ~1.5.
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {replacing && (
        <ReplaceDialog
          pos={replacing.pos}
          players={players}
          exclude={new Set(squad.map((s) => s.id))}
          budget={bank + (replacing.index !== null ? squad[replacing.index].sell : 0)}
          clubCount={clubCount}
          outgoingTeam={replacing.index !== null ? byId.get(squad[replacing.index].id)?.team : undefined}
          onPick={(id) => replace(replacing.index, id)}
          onClose={() => setReplacing(null)}
        />
      )}
    </div>
  );
}

function Pitch(props: {
  ids: number[];
  byId: Map<number, SlimPlayer>;
  lineup?: Scenario["result"]["lineups"][number];
  incoming: Set<number>;
  locked: number[];
  banned: number[];
  editable: boolean;
  squad: Slot[];
  counts: Record<string, number>;
  gwLabel: string;
  onReplace: (index: number | null, pos: SlimPlayer["pos"]) => void;
  onRemove: (index: number) => void;
  onToggleLock: (id: number) => void;
  onToggleBan: (id: number) => void;
}) {
  const { ids, byId, lineup } = props;
  const starters = lineup ? new Set(lineup.starters) : null;
  const onPitch = starters ? ids.filter((id) => starters.has(id)) : ids;
  const bench = lineup ? lineup.bench : [];
  const row = (pos: SlimPlayer["pos"]) => onPitch.filter((id) => byId.get(id)?.pos === pos);
  const empties = (pos: SlimPlayer["pos"]) => (props.editable && !lineup ? LIMITS[pos] - (props.counts[pos] ?? 0) : 0);

  const card = (id: number) => (
    <PlayerCard
      key={id}
      p={byId.get(id)!}
      captain={lineup?.captain === id}
      vice={lineup?.vice === id}
      isNew={props.incoming.has(id)}
      locked={props.locked.includes(id)}
      editable={props.editable}
      onReplace={() => props.onReplace(props.squad.findIndex((s) => s.id === id), byId.get(id)!.pos)}
      onRemove={() => props.onRemove(props.squad.findIndex((s) => s.id === id))}
      onToggleLock={() => props.onToggleLock(id)}
    />
  );

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div
        className="space-y-3 px-1 py-4 sm:px-4"
        style={{ background: "linear-gradient(180deg, color-mix(in srgb, var(--good) 22%, var(--surface)) 0%, color-mix(in srgb, var(--good) 12%, var(--surface)) 100%)" }}
      >
        {POSITIONS.map((pos) => (
          <div key={pos} className="flex flex-wrap justify-center gap-1 sm:gap-2">
            {row(pos).map(card)}
            {Array.from({ length: Math.max(0, empties(pos)) }, (_, i) => (
              <button
                key={`e${i}`}
                onClick={() => props.onReplace(null, pos)}
                className="flex h-[104px] w-[60px] flex-col items-center justify-center rounded-lg border-2 border-dashed border-border bg-surface/60 text-[11px] text-muted hover:bg-surface sm:h-[118px] sm:w-[92px] sm:text-xs"
              >
                <span className="text-lg">+</span>Add {pos}
              </button>
            ))}
          </div>
        ))}
      </div>
      {bench.length > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-1 border-t border-border bg-surface-2 px-1 py-3 sm:gap-2 sm:px-2">
          <span className="w-full text-center text-[10px] uppercase tracking-wide text-muted sm:w-auto">Bench</span>
          {bench.map(card)}
        </div>
      )}
      <div className="border-t border-border bg-surface px-3 py-1.5 text-center text-[11px] text-muted">
        Card numbers: {props.gwLabel} xPts · horizon total. {props.editable ? "Click a player to swap or remove them, or lock them in." : ""}
      </div>
    </div>
  );
}

function PlayerCard(props: {
  p: SlimPlayer;
  captain: boolean;
  vice: boolean;
  isNew: boolean;
  locked: boolean;
  editable: boolean;
  onReplace: () => void;
  onRemove: () => void;
  onToggleLock: () => void;
}) {
  const { p } = props;
  const [menu, setMenu] = useState(false);
  const next = p.fixtures.filter((f) => f.gw === p.fixtures[0]?.gw);
  return (
    <div className="relative">
      <button
        onClick={() => props.editable && setMenu(!menu)}
        className={`flex h-[104px] w-[60px] flex-col items-center rounded-lg border bg-surface px-0.5 pt-1 text-center shadow-sm sm:h-[118px] sm:w-[92px] sm:px-1 sm:pt-1.5 ${
          props.isNew ? "border-accent ring-2 ring-accent/40" : "border-border"
        }`}
      >
        <span className="text-[10px] font-semibold text-muted">{p.teamShort}</span>
        <span className="mt-0.5 flex w-full items-center justify-center text-[11px] font-semibold sm:text-xs">
          <span className="truncate">{p.name}</span>
          <StatusDot status={p.status} chance={p.chance} news={p.news} />
        </span>
        <span className="mt-1 flex gap-0.5">{next.length ? next.map((f, i) => <FixtureChip key={i} f={f} compact />) : <span className="text-[10px] text-muted">Blank</span>}</span>
        <span className="mt-1 tabular text-sm font-semibold">{p.byGw[0]?.toFixed(1)}</span>
        <span className="tabular text-[10px] text-muted">
          {p.xpts.toFixed(1)}
          <span className="hidden sm:inline"> · {fmt.price(p.price)}</span>
        </span>
      </button>
      {(props.captain || props.vice) && (
        <span className={`absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold ${props.captain ? "bg-accent text-accent-text" : "bg-surface-2 text-text"}`}>
          {props.captain ? "C" : "V"}
        </span>
      )}
      {props.locked && <span className="absolute left-1 top-1 rounded bg-text px-1 text-[9px] font-bold text-bg">LOCK</span>}
      {menu && props.editable && (
        <div className="absolute left-1/2 top-full z-10 mt-1 w-36 -translate-x-1/2 overflow-hidden rounded-lg border border-border bg-surface text-sm shadow-lg">
          <button className="block w-full px-3 py-2 text-left hover:bg-surface-2" onClick={() => { setMenu(false); props.onReplace(); }}>Swap player</button>
          <button className="block w-full px-3 py-2 text-left hover:bg-surface-2" onClick={() => { setMenu(false); props.onToggleLock(); }}>{props.locked ? "Unlock" : "Lock (keep)"}</button>
          <button className="block w-full px-3 py-2 text-left text-bad hover:bg-surface-2" onClick={() => { setMenu(false); props.onRemove(); }}>Remove</button>
        </div>
      )}
    </div>
  );
}

function ScenarioCard({ s, byId, active, onSelect, onApply }: { s: Scenario; byId: Map<number, SlimPlayer>; active: boolean; onSelect: () => void; onApply: () => void }) {
  const r = s.result;
  const name = (id: number) => byId.get(id)?.name ?? `#${id}`;
  const showSwaps = s.key !== "wildcard" && s.key !== "freehit" && s.key !== "complete";
  return (
    <div className={`rounded-xl border bg-surface p-4 ${active ? "border-accent" : "border-border"}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 font-medium">
            {s.title}
            {s.recommended && <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold uppercase text-accent-text">Best</span>}
          </div>
          <p className="text-xs text-muted">{s.description}</p>
        </div>
        <div className="text-right">
          <div className={`tabular text-lg font-semibold ${s.gainVsHold > 0 ? "text-good" : ""}`}>{s.key === "hold" || s.key === "complete" ? r.netPoints.toFixed(1) : `${s.gainVsHold >= 0 ? "+" : ""}${s.gainVsHold.toFixed(1)}`}</div>
          <div className="text-[10px] uppercase tracking-wide text-muted">{s.key === "hold" || s.key === "complete" ? "xPts" : s.key === "freehit" ? "vs hold, 1 GW" : "vs hold"}</div>
        </div>
      </div>
      {showSwaps && r.transfersIn.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm">
          {r.transfersOut.map((out, i) => (
            <li key={out} className="flex items-center gap-2">
              <span className="truncate text-bad">{name(out)}</span>
              <span className="text-muted">→</span>
              <span className="truncate font-medium text-good">{name(r.transfersIn[i])}</span>
              <span className="ml-auto tabular text-xs text-muted">{fmt.price(byId.get(r.transfersIn[i])?.price ?? 0)}</span>
            </li>
          ))}
        </ul>
      )}
      {!showSwaps && r.transfersIn.length > 0 && <p className="mt-2 text-xs text-muted">{r.transfersIn.length} new players: preview to see the squad</p>}
      <div className="mt-3 flex items-center gap-3 text-xs text-muted">
        <span>C: <span className="font-medium text-text">{name(r.lineups[0]?.captain)}</span></span>
        <span>Bank after £{(r.bankAfter / 10).toFixed(1)}m</span>
        {r.hits > 0 && <span className="text-bad">-{r.hits * 4} hit</span>}
        <span className="ml-auto flex gap-2">
          <button onClick={onSelect} className="rounded-md border border-border px-2 py-1 hover:bg-surface-2">{active ? "Hide" : "Preview"}</button>
          {(r.transfersIn.length > 0 || s.key === "complete") && s.key !== "freehit" && (
            <button onClick={onApply} className="rounded-md bg-accent px-2 py-1 font-medium text-accent-text">Apply</button>
          )}
        </span>
      </div>
    </div>
  );
}

function ReplaceDialog(props: {
  pos: SlimPlayer["pos"];
  players: SlimPlayer[];
  exclude: Set<number>;
  budget: number; // tenths
  clubCount: Map<number, number>;
  outgoingTeam?: number;
  onPick: (id: number) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [affordable, setAffordable] = useState(true);
  const list = props.players
    .filter((p) => p.pos === props.pos && !props.exclude.has(p.id) && !p.inactive)
    .filter((p) => !affordable || Math.round(p.price * 10) <= props.budget)
    .filter((p) => (props.clubCount.get(p.team) ?? 0) - (p.team === props.outgoingTeam ? 1 : 0) < 3)
    .filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()) || p.teamShort.toLowerCase() === q.toLowerCase())
    .sort((a, b) => b.xpts - a.xpts)
    .slice(0, 40);
  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={props.onClose}>
      <div className="max-h-[80vh] w-full max-w-lg overflow-hidden rounded-t-2xl border border-border bg-surface sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-border p-3">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${props.pos} or team (e.g. ARS)`} className="flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm" />
          <button onClick={props.onClose} className="rounded-lg px-3 py-2 text-sm text-muted hover:bg-surface-2">Close</button>
        </div>
        <div className="flex items-center justify-between px-3 py-2 text-xs text-muted">
          <span>Budget £{(props.budget / 10).toFixed(1)}m</span>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={affordable} onChange={(e) => setAffordable(e.target.checked)} className="accent-[var(--accent)]" /> Affordable only
          </label>
        </div>
        <ul className="max-h-[60vh] divide-y divide-border overflow-y-auto">
          {list.map((p) => (
            <li key={p.id}>
              <button onClick={() => props.onPick(p.id)} className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-surface-2">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{p.name}</span> <StatusDot status={p.status} chance={p.chance} news={p.news} />
                  <span className="block text-xs text-muted">{p.teamShort} · {fmt.price(p.price)} · {fmt.pct(p.ownership)}</span>
                </span>
                <span className="hidden gap-1 sm:flex">{p.fixtures.slice(0, 3).map((f, i) => <FixtureChip key={i} f={f} compact />)}</span>
                <span className="w-12 text-right tabular font-semibold">{p.xpts.toFixed(1)}</span>
              </button>
            </li>
          ))}
          {list.length === 0 && <li className="p-4 text-center text-sm text-muted">No players match.</li>}
        </ul>
      </div>
    </div>
  );
}
