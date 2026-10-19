"use client";
import { useEffect, useState } from "react";
import type { SavedTeamData } from "@/lib/team/saved";

type Info = { id: string; exists: boolean; savedAt?: string; teamName?: string | null };

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/**
 * Save the current team to the cloud under the FPL ID, protected by a PIN, and load it on
 * any device. The PIN is only kept in memory, never in localStorage.
 */
export function CloudSave({
  entryId,
  canSave,
  getData,
  onLoad,
}: {
  entryId: string;
  canSave: boolean;
  getData: () => SavedTeamData;
  onLoad: (d: SavedTeamData, savedAt: string) => void;
}) {
  const id = /^\d{1,9}$/.test(entryId.trim()) ? entryId.trim() : null;
  const [info, setInfo] = useState<Info | null>(null);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState<"save" | "load" | null>(null);
  const [msg, setMsg] = useState<{ id: string; ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!id) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/saved-team/${id}`, { signal: ctrl.signal, cache: "no-store" });
        if (res.ok) setInfo({ id, ...(await res.json()) });
      } catch {}
    }, 400);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [id]);

  if (!id) return null;
  const current = info?.id === id ? info : null;
  const message = msg?.id === id ? msg : null;

  async function call(kind: "save" | "load") {
    if (pin.length < 4) return setMsg({ id: id!, ok: false, text: "PIN must be at least 4 characters." });
    setBusy(kind);
    setMsg(null);
    try {
      const res = await fetch(`/api/saved-team/${id}`, {
        method: kind === "save" ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(kind === "save" ? { pin, data: getData() } : { pin }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Something went wrong");
      if (kind === "save") {
        setInfo({ id: id!, exists: true, savedAt: body.savedAt, teamName: getData().teamName ?? null });
        setMsg({ id: id!, ok: true, text: body.created ? "Saved. Use the same ID and PIN to load it anywhere." : "Saved." });
      } else {
        onLoad(body.data, body.savedAt);
        setMsg({ id: id!, ok: true, text: `Loaded your save from ${when(body.savedAt)}.` });
      }
    } catch (e) {
      setMsg({ id: id!, ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  const exists = current?.exists ?? false;
  return (
    <div className="rounded-xl border border-border bg-surface p-4 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium">Cloud save</span>
        <span className="text-xs text-muted">
          {current === null
            ? "Checking…"
            : exists
              ? `Team ${id} has a save from ${when(current.savedAt!)}${current.teamName ? ` (${current.teamName})` : ""}`
              : `No save for team ${id} yet. Choose a PIN to create one.`}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="password"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (exists ? call("load") : canSave && call("save"))}
          placeholder={exists ? "Your PIN" : "Choose a PIN (4+ characters)"}
          autoComplete="off"
          className="w-52 rounded-lg border border-border bg-bg px-3 py-2"
        />
        {exists && (
          <button onClick={() => call("load")} disabled={busy !== null} className="rounded-lg bg-accent px-4 py-2 font-medium text-accent-text disabled:opacity-50">
            {busy === "load" ? "Loading…" : "Load save"}
          </button>
        )}
        <button
          onClick={() => call("save")}
          disabled={busy !== null || !canSave}
          title={canSave ? undefined : "Import or build a team first"}
          className={`rounded-lg px-4 py-2 font-medium disabled:opacity-50 ${exists ? "border border-border hover:bg-surface-2" : "bg-accent text-accent-text"}`}
        >
          {busy === "save" ? "Saving…" : exists ? "Overwrite with current team" : "Save current team"}
        </button>
      </div>
      {message && <p className={`mt-2 text-xs ${message.ok ? "text-good" : "text-bad"}`}>{message.text}</p>}
      <p className="mt-2 text-xs text-muted">
        Saves your squad, bank, free transfers, locked/excluded players and chips. The PIN protects the save from being overwritten by
        anyone else who knows your FPL ID. Don&apos;t reuse an important password.
      </p>
    </div>
  );
}
