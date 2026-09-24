import { KeyRound, X } from "lucide-react";
import { SharedLayoutBg } from "@/components/motion/shared-layout-bg";
import { ThemeToggle } from "@/components/motion/theme-toggle";
import { Link, usePath } from "@/lib/router";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Home" },
  { to: "/create", label: "Create" },
  { to: "/films", label: "Explore" },
];

type KeyProps = { hasKey?: boolean; onKey?: () => void; onDisconnect?: () => void };

function KeyButton({ hasKey, onKey, onDisconnect }: KeyProps) {
  if (!hasKey)
    return (
      <button type="button" onClick={onKey} className="ml-1 inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-foreground px-3.5 text-sm font-medium text-background transition-opacity hover:opacity-90 sm:ml-2">
        <KeyRound className="size-3.5" /> <span className="hidden sm:inline">Connect fal key</span>
        <span className="sm:hidden">Key</span>
      </button>
    );
  return (
    <span className="ml-1 inline-flex h-10 shrink-0 items-center gap-1 rounded-full border border-border pr-1 pl-3 text-sm text-muted-foreground sm:ml-2">
      <span className="size-1.5 rounded-full bg-success" />
      <span className="hidden sm:inline">fal key</span>
      <button type="button" onClick={onDisconnect} title="Remove the key from this browser" aria-label="Remove the fal key" className="grid size-8 place-items-center rounded-full hover:bg-muted hover:text-foreground">
        <X className="size-3.5" />
      </button>
    </span>
  );
}

export function Header({ hasKey, onKey, onDisconnect }: KeyProps) {
  const path = usePath();
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-2 px-3 sm:px-6">
        <Link to="/" aria-label="Storycast" className="flex shrink-0 items-center gap-2.5">
          <img src="/logo.svg" alt="" className="size-9" />
          <span className="hidden text-[17px] font-semibold tracking-tight sm:inline">Storycast</span>
        </Link>
        <nav className="flex items-center gap-1">
          <SharedLayoutBg className="w-auto flex-row items-center gap-1" pillClassName="rounded-full bg-muted" inset={0}>
            {NAV.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                aria-current={(n.to === "/" ? path === "/" : path.startsWith(n.to)) ? "page" : undefined}
                className={cn(
                  "relative rounded-full px-2 py-1.5 text-sm transition-colors sm:px-3.5",
                  (n.to === "/" ? path === "/" : path.startsWith(n.to)) ? "bg-card text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {n.label}
              </Link>
            ))}
          </SharedLayoutBg>
          <KeyButton hasKey={hasKey} onKey={onKey} onDisconnect={onDisconnect} />
          <ThemeToggle
            variant="circle-blur"
            className="ml-1 size-10 shrink-0 rounded-full border border-border text-muted-foreground transition-colors hover:text-foreground sm:ml-2"
            iconClassName="size-4"
          />
        </nav>
      </div>
    </header>
  );
}
