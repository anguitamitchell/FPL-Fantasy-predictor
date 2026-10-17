"use client";
import { useSyncExternalStore } from "react";

// A 30-second clock; null during SSR/hydration so server and client markup match.
const subscribe = (cb: () => void) => {
  const t = setInterval(cb, 30_000);
  return () => clearInterval(t);
};
const tick = () => Math.floor(Date.now() / 30_000) * 30_000;

export function Deadline({ iso }: { iso: string }) {
  const now = useSyncExternalStore(subscribe, tick, () => null);
  const d = new Date(iso);
  const label = d.toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  if (now === null) return <span>{label}</span>;
  const ms = d.getTime() - now;
  if (ms <= 0) return <span>{label} (passed)</span>;
  const h = Math.floor(ms / 3600_000);
  const days = Math.floor(h / 24);
  const rem = days > 0 ? `${days}d ${h % 24}h` : `${h}h ${Math.floor((ms % 3600_000) / 60_000)}m`;
  return (
    <span>
      {label} · <span className="font-medium text-text">{rem} left</span>
    </span>
  );
}
