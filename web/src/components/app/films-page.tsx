import { ChevronLeft, ChevronRight, LayoutGrid, List, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { FilmCard } from "@/components/app/film-card";
import { Input } from "@/components/motion/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/motion/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/motion/tabs";
import { cn } from "@/lib/utils";
import { languageName, nativeLanguage, type CastMember, type Film } from "@/lib/api";
import { SHARING, owned } from "@/lib/share";
import { AgentPromptButton } from "@/components/app/agent-button";

const LENGTHS: Record<string, [number, number]> = { any: [0, 1e9], short: [0, 90], medium: [90, 240], long: [240, 1e9] };
const SORTS: Record<string, { label: string; fn: (a: Film, b: Film) => number }> = {
  newest: { label: "Newest", fn: (a, b) => b.created - a.created },
  oldest: { label: "Oldest", fn: (a, b) => a.created - b.created },
  longest: { label: "Longest", fn: (a, b) => b.duration - a.duration },
  shortest: { label: "Shortest", fn: (a, b) => a.duration - b.duration },
  title: { label: "A–Z", fn: (a, b) => a.title.localeCompare(b.title) },
};
const PAGE_SIZE = 24;

type Source = "all" | "community" | "mine";
type Filters = { source: Source; q: string; styles: string[]; lang: string; length: string; voice: string; narrator: string; sort: string; view: "grid" | "list"; page: number };
const DEFAULT: Filters = { source: "all", q: "", styles: [], lang: "any", length: "any", voice: "any", narrator: "any", sort: "newest", view: "grid", page: 1 };

function readUrl(): Filters {
  const p = new URLSearchParams(window.location.search);
  const source = p.get("source");
  return {
    source: source === "community" || source === "mine" ? source : "all",
    q: p.get("q") ?? "",
    styles: p.getAll("style"),
    lang: p.get("lang") ?? "any",
    length: p.get("length") ?? "any",
    voice: p.get("voice") ?? "any",
    narrator: p.get("narrator") ?? "any",
    sort: p.get("sort") ?? "newest",
    view: p.get("view") === "list" ? "list" : "grid",
    page: Math.max(1, Number(p.get("page")) || 1),
  };
}

function writeUrl(f: Filters) {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  f.styles.forEach((s) => p.append("style", s));
  for (const k of ["source", "lang", "length", "voice", "narrator", "sort", "view"] as const) if (f[k] !== DEFAULT[k]) p.set(k, f[k]);
  if (f.page > 1) p.set("page", String(f.page));
  const qs = p.toString();
  window.history.replaceState(null, "", `/films${qs ? `?${qs}` : ""}`);
}

function pageList(page: number, pages: number): (number | "…")[] {
  const keep = new Set([1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages));
  const out: (number | "…")[] = [];
  let last = 0;
  for (const n of [...keep].sort((a, b) => a - b)) {
    if (n - last > 2) out.push("…");
    else if (n - last === 2) out.push(n - 1);
    out.push(n);
    last = n;
  }
  return out;
}

function Pagination({ page, pages, onPage }: { page: number; pages: number; onPage: (n: number) => void }) {
  if (pages <= 1) return null;
  const step =
    "grid size-10 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground disabled:pointer-events-none disabled:opacity-40";
  return (
    <nav aria-label="Pages" className="flex items-center justify-center gap-1.5">
      <button type="button" className={step} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
        <ChevronLeft className="size-4" />
      </button>
      {pageList(page, pages).map((n, i) =>
        n === "…" ? (
          <span key={`gap-${i}`} className="w-6 text-center text-sm text-muted-foreground">
            …
          </span>
        ) : (
          <button
            key={n}
            type="button"
            onClick={() => onPage(n)}
            aria-current={n === page ? "page" : undefined}
            className={cn(
              "grid h-10 min-w-10 place-items-center rounded-full px-3 font-mono text-sm transition-colors",
              n === page ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {n}
          </button>
        ),
      )}
      <button type="button" className={step} disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
        <ChevronRight className="size-4" />
      </button>
    </nav>
  );
}

function Pill({ active, onClick, children, count, className }: { active: boolean; onClick: () => void; children: React.ReactNode; count?: number; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm transition-colors",
        active ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:border-border-strong hover:text-foreground",
        className,
      )}
    >
      {children}
      {count !== undefined && <span className={cn("font-mono text-[11px]", active ? "opacity-70" : "opacity-50")}>{count}</span>}
    </button>
  );
}

function Row({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("scrollbar-hide -mx-4 flex gap-2 overflow-x-auto px-4 sm:-mx-6 sm:px-6 [mask-image:linear-gradient(to_right,black_94%,transparent)]", className)}>
      {children}
    </div>
  );
}

export function FilmsPage({ films: all, loading, cast = [] }: { films: Film[]; loading: boolean; cast?: CastMember[] }) {
  const [f, setF] = useState<Filters>(readUrl);

  const counts = useMemo(() => {
    const mine = new Set(Object.keys(owned()));
    return {
      mineOf: (x: Film) => Boolean(x.mine) || (x.community === true && mine.has(x.id)),
      community: all.filter((x) => x.community).length,
    };
  }, [all]);
  const films = useMemo(
    () => (f.source === "community" ? all.filter((x) => x.community) : f.source === "mine" ? all.filter(counts.mineOf) : all),
    [all, f.source, counts],
  );
  const mineCount = useMemo(() => all.filter(counts.mineOf).length, [all, counts]);
  const [search, setSearch] = useState(f.q);

  useEffect(() => writeUrl(f), [f]);
  useEffect(() => {
    const t = setTimeout(() => setF((prev) => (prev.q === search ? prev : { ...prev, q: search, page: 1 })), 200);
    return () => clearTimeout(t);
  }, [search]);

  const set = <K extends keyof Filters>(k: K, v: Filters[K]) =>
    setF((prev) => ({ ...prev, [k]: v, page: k === "page" ? (v as number) : k === "view" ? prev.page : 1 }));
  const toggle = (k: "lang" | "narrator", v: string) => set(k, f[k] === v ? "any" : v);
  const top = useRef<HTMLDivElement>(null);
  const goTo = (n: number) => {
    set("page", n);
    requestAnimationFrame(() => top.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const facets = useMemo(() => {
    const count = (key: (x: Film) => string) => {
      const m = new Map<string, number>();
      for (const x of films) {
        const k = key(x);
        if (k) m.set(k, (m.get(k) ?? 0) + 1);
      }
      return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ id, n }));
    };
    const styleLabels = new Map(films.map((x) => [x.style, x.style_label]));
    return {
      styles: count((x) => x.style).map((s) => ({ ...s, label: styleLabels.get(s.id) || s.id })),
      langs: count((x) => x.lang),
      voices: count((x) => x.voice),
      narrators: count((x) => x.narrator).map((n) => ({ ...n, member: cast.find((c) => c.name === n.id) })),
    };
  }, [films, cast]);

  const shown = useMemo(() => {
    const needle = f.q.toLowerCase().trim();
    const [lo, hi] = LENGTHS[f.length] ?? LENGTHS.any;
    return films
      .filter((x) => {
        if (needle && ![x.title, x.subtitle, x.topic, x.narrator, x.voice, x.style_label, languageName(x.lang), ...x.script].join(" ").toLowerCase().includes(needle))
          return false;
        if (f.styles.length && !f.styles.includes(x.style)) return false;
        if (f.lang !== "any" && x.lang !== f.lang) return false;
        if (f.voice !== "any" && x.voice !== f.voice) return false;
        if (f.narrator !== "any" && x.narrator !== f.narrator) return false;
        return x.duration >= lo && x.duration < hi;
      })
      .sort((SORTS[f.sort] ?? SORTS.newest).fn);
  }, [films, f]);

  const active = f.styles.length + (["lang", "length", "voice", "narrator"] as const).filter((k) => f[k] !== "any").length + (f.q ? 1 : 0);
  const totalMinutes = Math.round(shown.reduce((s, x) => s + x.duration, 0) / 60);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const page = Math.min(f.page, pages);
  const pageFilms = shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const clear = () => {
    setSearch("");
    setF({ ...DEFAULT, view: f.view, sort: f.sort, source: f.source });
  };

  return (
    <div className="flex flex-col gap-8 pt-12 pb-24">
      <header className="flex flex-col gap-5">
        <div>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Explore</p>
              <h1 className="mt-1 text-4xl font-semibold tracking-tight md:text-5xl">Stories to watch</h1>
            </div>
            <AgentPromptButton />
          </div>
          <Tabs value={f.source} onValueChange={(v) => set("source", v as Source)} variant="segment" className="mt-4">
            <TabsList>
              <TabsTrigger value="all">Everything</TabsTrigger>
              {SHARING && <TabsTrigger value="community">Shared by people{counts.community ? ` · ${counts.community}` : ""}</TabsTrigger>}
              <TabsTrigger value="mine">My stories{mineCount ? ` · ${mineCount}` : ""}</TabsTrigger>
            </TabsList>
          </Tabs>
          <p className="mt-2 text-sm text-muted-foreground">
            {loading
              ? "Loading the library…"
              : `${films.length} films · ${facets.narrators.length} narrators · ${facets.langs.length} languages · ${Math.round(films.reduce((s, x) => s + x.duration, 0) / 60)} min of story`}
          </p>
        </div>
        <Input
          value={search}
          onChange={setSearch}
          placeholder="Search by topic, narrator, language or a line from the script…"
          leftIcon={<Search className="size-4" />}
          className="w-full"
          classNames={{ field: "h-12" }}
        />
      </header>

      {facets.narrators.length > 1 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold tracking-tight">Narrators</h2>
          <Row className="gap-4 pt-1 pb-1">
            {facets.narrators.map((n) => {
              const on = f.narrator === n.id;
              return (
                <button key={n.id} type="button" onClick={() => toggle("narrator", n.id)} aria-pressed={on} title={`${n.n} film${n.n === 1 ? "" : "s"}`} className="group flex w-16 shrink-0 flex-col items-center gap-1.5">
                  <span
                    className={cn(
                      "size-16 overflow-hidden rounded-full bg-muted ring-2 ring-offset-2 ring-offset-background transition-all",
                      on ? "ring-foreground" : "ring-transparent group-hover:ring-border-strong",
                    )}
                  >
                    {n.member ? (
                      <img src={n.member.thumb} alt="" loading="lazy" className="size-full object-cover object-top" />
                    ) : (
                      <span className="grid size-full place-items-center text-lg font-medium text-muted-foreground">{n.id[0]}</span>
                    )}
                  </span>
                  <span className={cn("w-full truncate text-center text-xs", on ? "font-medium text-foreground" : "text-muted-foreground")}>{n.id}</span>
                </button>
              );
            })}
          </Row>
        </section>
      )}

      {facets.langs.length > 1 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold tracking-tight">Watch in</h2>
          <Row>
            <Pill active={f.lang === "any"} onClick={() => set("lang", "any")} count={films.length}>
              All languages
            </Pill>
            {facets.langs.map((l) => (
              <Pill key={l.id} active={f.lang === l.id} onClick={() => toggle("lang", l.id)} count={l.n}>
                <span title={languageName(l.id)}>{nativeLanguage(l.id)}</span>
              </Pill>
            ))}
          </Row>
        </section>
      )}

      <section ref={top} className="z-30 -mx-4 flex scroll-mt-16 flex-col gap-3 border-y border-border bg-background/85 px-4 py-3 backdrop-blur-xl sm:-mx-6 sm:px-6 lg:sticky lg:top-16">
        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={f.length} onValueChange={(v) => set("length", v)} variant="segment">
            <TabsList>
              <TabsTrigger value="any">Any length</TabsTrigger>
              <TabsTrigger value="short">Under 1½ min</TabsTrigger>
              <TabsTrigger value="medium">1½–4 min</TabsTrigger>
              <TabsTrigger value="long">4+ min</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Select value={f.voice} onValueChange={(v) => set("voice", v)}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Voice" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any voice</SelectItem>
                {facets.voices.map((v) => (
                  <SelectItem key={v.id} value={v.id} label={v.id.split(" - ")[0]}>
                    {v.id.split(" - ")[0]} <span className="text-muted-foreground">{v.n}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={f.sort} onValueChange={(v) => set("sort", v)}>
              <SelectTrigger className="w-32">
                <SelectValue placeholder="Sort" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(SORTS).map(([k, s]) => (
                  <SelectItem key={k} value={k}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Tabs value={f.view} onValueChange={(v) => set("view", v as Filters["view"])} variant="segment">
              <TabsList>
                <TabsTrigger value="grid">
                  <LayoutGrid className="size-4" aria-label="Grid" />
                </TabsTrigger>
                <TabsTrigger value="list">
                  <List className="size-4" aria-label="List" />
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>
        <Row className="gap-1.5">
          {facets.styles.map((s) => (
            <Pill
              key={s.id}
              className="px-3 py-1 text-xs"
              active={f.styles.includes(s.id)}
              count={s.n}
              onClick={() => set("styles", f.styles.includes(s.id) ? f.styles.filter((x) => x !== s.id) : [...f.styles, s.id])}
            >
              {s.label}
            </Pill>
          ))}
        </Row>
      </section>

      <div className="-mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <p>
          {loading ? "…" : `${shown.length} film${shown.length === 1 ? "" : "s"} · ${totalMinutes} min`}
          {pages > 1 && ` · page ${page} of ${pages}`}
        </p>
        {active > 0 && (
          <button type="button" onClick={clear} className="inline-flex items-center gap-1 hover:text-foreground">
            <X className="size-3.5" /> Clear {active} filter{active > 1 ? "s" : ""}
          </button>
        )}
      </div>

      {loading ? (
        <div className="grid gap-x-4 gap-y-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="aspect-video rounded-2xl bg-muted" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-border-strong p-12 text-center">
          <p className="text-sm text-muted-foreground">
            {f.source === "mine" && !films.length
              ? "Films you make or share in this browser show up here."
              : f.source === "community" && !films.length
                ? "No shared stories yet. Make one and share it to Explore."
                : "No films match these filters."}
          </p>
          <button type="button" onClick={clear} className="text-sm font-medium hover:underline">
            Show all films
          </button>
        </div>
      ) : (
        <div className={cn("grid gap-x-4 gap-y-6", f.view === "grid" ? "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" : "grid-cols-1")}>
          {pageFilms.map((x) => (
            <FilmCard key={x.id} film={x} layout={f.view} />
          ))}
        </div>
      )}
      <Pagination page={page} pages={pages} onPage={goTo} />
    </div>
  );
}
