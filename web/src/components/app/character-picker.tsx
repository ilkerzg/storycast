import { motion } from "motion/react";
import { Check, Expand, ImagePlus, Pause, Search, Sparkles, Volume2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/motion/tabs";
import { Lightbox, type LightboxItem } from "@/components/app/lightbox";
import { TiltCard } from "@/components/motion/tilt-card";
import { SPRING_LAYOUT } from "@/lib/ease";
import { usePlayer } from "@/lib/use-player";
import { cn } from "@/lib/utils";
import { api, type CastMember } from "@/lib/api";

export type CharacterChoice = { kind: "cast"; id: string } | { kind: "new" } | { kind: "upload" };

function Ring() {
  return (
    <motion.span
      layoutId="character-selected"
      transition={SPRING_LAYOUT}
      className="pointer-events-none absolute inset-0 z-10 rounded-xl ring-2 ring-primary ring-offset-2 ring-offset-background"
    >
      <span className="absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg">
        <Check className="size-3" strokeWidth={3} />
      </span>
    </motion.span>
  );
}

type Props = {
  cast: CastMember[];
  groups: string[];
  value: CharacterChoice;
  onChange: (c: CharacterChoice) => void;
  uploadPreview?: string;
  lang: string;
};

export function CharacterPicker({ cast, groups, value, onChange, uploadPreview, lang }: Props) {
  const player = usePlayer();
  const [view, setView] = useState<{ items: LightboxItem[]; i: number } | null>(null);
  const [group, setGroup] = useState("All");
  const [q, setQ] = useState("");
  const isCast = (id: string) => value.kind === "cast" && value.id === id;
  const shown = useMemo(() => {
    const needle = q.toLowerCase().trim();
    return cast.filter(
      (c) => (group === "All" || c.group === group) && (!needle || `${c.name} ${c.personality} ${c.style_label}`.toLowerCase().includes(needle)),
    );
  }, [cast, group, q]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="-mx-1 min-w-0 overflow-x-auto px-1">
          <Tabs value={group} onValueChange={setGroup} variant="segment">
            <TabsList>
              <TabsTrigger value="All">All {cast.length}</TabsTrigger>
              {groups.map((g) => (
                <TabsTrigger key={g} value={g}>
                  {g} <span className="ml-1 opacity-50">{cast.filter((c) => c.group === g).length}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
        <label className="ml-auto flex h-9 min-w-44 items-center gap-2 rounded-full border border-border bg-background/50 px-3 text-sm focus-within:border-border-strong">
          <Search className="size-3.5 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a character" className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground" />
        </label>
      </div>
      <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-5 xl:grid-cols-7 2xl:grid-cols-9">
        <button type="button" onClick={() => onChange({ kind: "new" })} aria-pressed={value.kind === "new"} className="relative text-left">
          <div className="flex aspect-[3/4] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border-strong bg-card px-2 text-center transition-colors hover:border-primary/60">
            <span className="flex size-9 items-center justify-center rounded-full bg-muted">
              <Sparkles className="size-4 text-accent" />
            </span>
            <span className="text-[12.5px] font-semibold">Invent one</span>
            <span className="text-[10.5px] leading-snug text-muted-foreground">A new character for your topic, in any look</span>
          </div>
          {value.kind === "new" && <Ring />}
        </button>

        <button type="button" onClick={() => onChange({ kind: "upload" })} aria-pressed={value.kind === "upload"} className="relative text-left">
          <div
            className={cn(
              "relative flex aspect-[3/4] flex-col items-center justify-center gap-2 overflow-hidden rounded-xl border border-dashed border-border-strong bg-card px-2 text-center transition-colors hover:border-primary/60",
            )}
          >
            {uploadPreview ? (
              <img src={uploadPreview} alt="" className="absolute inset-0 size-full object-cover" />
            ) : (
              <>
                <span className="flex size-9 items-center justify-center rounded-full bg-muted">
                  <ImagePlus className="size-4" />
                </span>
                <span className="text-[12.5px] font-semibold">Your own</span>
                <span className="text-[10.5px] leading-snug text-muted-foreground">Upload a character, we redraw it</span>
              </>
            )}
          </div>
          {value.kind === "upload" && <Ring />}
        </button>

        {shown.map((c) => (
          <div key={c.id} className="group/card relative">
            <button type="button" onClick={() => onChange({ kind: "cast", id: c.id })} aria-pressed={isCast(c.id)} title={c.personality} className="block w-full text-left">
              <TiltCard max={6} className="rounded-xl border border-border bg-card">
                <img src={c.thumb} alt="" loading="lazy" className="aspect-[3/4] w-full object-cover" />
                <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-2 pt-8 pb-1.5">
                  <span className="block truncate text-[12.5px] font-semibold text-white">{c.name}</span>
                  <span className="block truncate text-[10.5px] text-white/70">{c.style_label}</span>
                  <span className="grid grid-rows-[0fr] transition-[grid-template-rows] duration-300 group-hover/card:grid-rows-[1fr]">
                    <span className="overflow-hidden pt-0.5 text-[10.5px] leading-snug text-white/85">{c.personality}</span>
                  </span>
                </span>
              </TiltCard>
            </button>
            <button
              type="button"
              onClick={() =>
                setView({
                  items: [
                    { url: c.hero, kind: "image", caption: `${c.name} · ${c.personality}` },
                    { url: c.sheet, kind: "image", caption: `${c.name} · model sheet` },
                  ],
                  i: 0,
                })
              }
              aria-label={`Look at ${c.name}`}
              className="absolute top-1.5 left-1.5 z-20 flex size-6 items-center justify-center rounded-full bg-black/45 text-white opacity-0 backdrop-blur transition-opacity group-hover/card:opacity-100 hover:bg-black/70"
            >
              <Expand className="size-3" />
            </button>
            <button
              type="button"
              onClick={() => player.toggle(c.id, api.characterVoice(c.id, lang))}
              aria-label={player.playing === c.id ? `Stop ${c.name}` : `Hear ${c.name}`}
              title={`Hear ${c.name} (${c.voice.name.split(/\s+[-–]\s+/)[0]})`}
              className={cn(
                "absolute top-1.5 right-1.5 z-20 flex size-7 items-center justify-center rounded-full text-white backdrop-blur transition-opacity hover:bg-black/70",
                player.playing === c.id ? "bg-primary opacity-100" : "bg-black/45 opacity-0 group-hover/card:opacity-100",
                isCast(c.id) && "top-8",
              )}
            >
              {player.playing === c.id ? <Pause className="size-3 fill-current" /> : <Volume2 className="size-3.5" />}
            </button>
            {isCast(c.id) && <Ring />}
          </div>
        ))}

        <Lightbox items={view?.items ?? []} index={view ? view.i : null} onIndex={(i) => setView((v) => (v ? { ...v, i } : v))} onClose={() => setView(null)} />
      </div>
    </div>
  );
}
