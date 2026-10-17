"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/players", label: "Players" },
  { href: "/differentials", label: "Differentials" },
  { href: "/fixtures", label: "Fixtures" },
  { href: "/team", label: "My Team" },
];

export function Nav() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-surface/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2 py-3 font-semibold">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-accent text-sm font-bold text-accent-text">xP</span>
          <span className="hidden sm:inline">FPL Predictor</span>
        </Link>
        <nav className="-mb-px flex min-w-0 gap-1 overflow-x-auto text-sm">
          {LINKS.map((l) => {
            const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`whitespace-nowrap border-b-2 px-3 py-3.5 transition-colors ${
                  active ? "border-accent font-medium text-text" : "border-transparent text-muted hover:text-text"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
