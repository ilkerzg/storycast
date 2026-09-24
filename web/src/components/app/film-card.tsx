import { Languages, Play } from "lucide-react";
import { useState } from "react";
import { navigate } from "@/lib/router";
import { cn } from "@/lib/utils";
import { languageName, nativeLanguage, type Film } from "@/lib/api";

export function fmtDuration(s: number) {
  const m = Math.floor(s / 60);
  return m ? `${m}:${String(Math.round(s % 60)).padStart(2, "0")}` : `${Math.round(s)} s`;
}

export function FilmCard({ film, layout = "grid" }: { film: Film; layout?: "grid" | "list" }) {
  const [hover, setHover] = useState(false);
  const list = layout === "list";
  const to = `/films/${film.id}`;
  return (
    <a
      href={to}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(to);
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={cn("group block text-left", list && "flex items-center gap-4 rounded-2xl p-2 transition-colors hover:bg-muted/50")}
    >
      <div className={cn("relative aspect-video shrink-0 overflow-hidden rounded-2xl bg-muted ring-1 ring-border transition-shadow group-hover:shadow-xl", list ? "w-44 rounded-xl sm:w-56" : "w-full")}>
        {(film.thumb || film.poster) && (
          <img src={film.thumb || film.poster!} alt="" loading="lazy" className="absolute inset-0 size-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
        )}
        {hover && <video src={film.video} muted autoPlay loop playsInline preload="none" className="absolute inset-0 size-full object-cover" />}
        <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-full bg-black/65 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
          <Languages className="size-3" /> {nativeLanguage(film.lang)}
        </span>
        <span className="absolute right-2 bottom-2 rounded-md bg-black/70 px-1.5 py-0.5 font-mono text-[11px] text-white">{fmtDuration(film.duration)}</span>
        <span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
          <span className="flex size-11 items-center justify-center rounded-full bg-background/80 backdrop-blur-md">
            <Play className="size-4 translate-x-px fill-current" />
          </span>
        </span>
      </div>
      <div className={cn("min-w-0", list ? "flex-1 py-1 pr-2" : "px-1 pt-3")}>
        <p className="line-clamp-2 text-sm leading-snug">
          <span className="font-semibold">{film.title}</span> <span className="text-muted-foreground">{film.subtitle}</span>
        </p>
        <p className="mt-1 truncate text-xs text-muted-foreground">
          {[languageName(film.lang), film.narrator, film.style_label].filter(Boolean).join(" · ")}
        </p>
        {list && film.script[0] && <p className="mt-2 line-clamp-2 text-xs text-muted-foreground/80">{film.script[0]}</p>}
      </div>
    </a>
  );
}
