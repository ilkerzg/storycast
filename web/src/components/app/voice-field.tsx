import { AnimatePresence, motion } from "motion/react";
import { AudioLines, Library, Pause, Play, X } from "lucide-react";
import { useEffect, useState } from "react";
import { VoiceLibrary, pretty, previewFor, splitName } from "@/components/app/voice-library";
import { EASE_OUT } from "@/lib/ease";
import { usePlayer } from "@/lib/use-player";
import { api, type Voice } from "@/lib/api";
import { SHARE_API } from "@/lib/share";

type Props = {
  value: Voice | null;
  onChange: (v: Voice | null) => void;
  lang: string;
  topic: string;
  fallback?: { title: string; detail: string };
};

export function VoiceField({ value, onChange, lang, topic, fallback }: Props) {
  const [open, setOpen] = useState(false);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    if (SHARE_API) api.voiceFacets().then((f) => setTotal(f.total)).catch(() => {});
  }, []);
  const player = usePlayer();
  const playing = value && player.playing === value.voice_id;

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-background/50 p-2 pr-2.5">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={value?.voice_id ?? fallback?.title ?? "director"}
          initial={{ opacity: 0, filter: "blur(6px)", y: 4 }}
          animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
          exit={{ opacity: 0, filter: "blur(6px)", y: -4 }}
          transition={{ duration: 0.3, ease: EASE_OUT }}
          className="flex min-w-0 flex-1 items-center gap-3"
        >
          {value ? (
            <button
              type="button"
              onClick={() => player.toggle(value.voice_id, previewFor(value, lang))}
              aria-label={playing ? "Pause preview" : "Play preview"}
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-card ring-1 ring-border"
            >
              {playing ? <Pause className="size-4 fill-current" /> : <Play className="size-4 translate-x-px fill-current" />}
            </button>
          ) : (
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted">
              <AudioLines className="size-4 text-accent" />
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{value ? splitName(value.name).name : (fallback?.title ?? "Director's choice")}</p>
            <p className="truncate text-xs text-muted-foreground">
              {value
                ? [value.gender, value.age, value.accent, ...value.tags.slice(0, 2)].filter(Boolean).map(pretty).join(" · ")
                : (fallback?.detail ?? "Matched to the character")}
            </p>
          </div>
        </motion.div>
      </AnimatePresence>
      {value && (
        <button type="button" onClick={() => onChange(null)} aria-label="Clear voice" className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground">
          <X className="size-4" />
        </button>
      )}
      {total > 0 && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-xs font-medium transition-colors hover:border-border-strong"
        >
          <Library className="size-3.5" />
          {`${total.toLocaleString("en")} voices`}
        </button>
      )}
      {total > 0 && <VoiceLibrary open={open} onOpenChange={setOpen} lang={lang} topic={topic} selected={value} onSelect={onChange} />}
    </div>
  );
}
