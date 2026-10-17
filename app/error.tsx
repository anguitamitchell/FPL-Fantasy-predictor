"use client";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const updating = /updating|503/i.test(error.message);
  return (
    <div className="mx-auto max-w-lg rounded-xl border border-border bg-surface p-6 text-center">
      <h2 className="text-lg font-semibold">{updating ? "FPL is updating" : "Couldn't load FPL data"}</h2>
      <p className="mt-2 text-sm text-muted">
        {updating
          ? "The official API is offline while the game updates (usually around deadlines and after matches). Try again in a few minutes."
          : "The official FPL API didn't respond. This is usually temporary."}
      </p>
      <button onClick={reset} className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-text">Try again</button>
    </div>
  );
}
