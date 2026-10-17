"use client";
import { useEffect, useState } from "react";

export function Deadline({ iso }: { iso: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
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
