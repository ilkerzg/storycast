import { AnimatePresence, motion } from "motion/react";
import { Download, Film as FilmIcon, Mic, Share2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AgentProgress } from "@/components/agents/loading-states/agent-progress";
import { TodoList, type TodoItem } from "@/components/agents/todo-list";
import { Button } from "@/components/motion/button/base";
import { TextShimmer } from "@/components/motion/text-shimmer";
import { FilmPlayer } from "@/components/app/film-player";
import { Lightbox, downloadFile, type LightboxItem } from "@/components/app/lightbox";
import { EASE_OUT } from "@/lib/ease";
import { navigate } from "@/lib/router";
import { SHARING } from "@/lib/share";
import { cn } from "@/lib/utils";
import { STAGES, clock, type Job, type JobEvent } from "@/lib/api";

type Props = { job: Job; events: JobEvent[]; onResume?: () => void };

function stageItems(job: Job, events: JobEvent[]): TodoItem[] {
  const seen = new Set(events.map((e) => e.stage));
  const current = STAGES.findIndex(([k]) => k === job.stage);
  const reached = Math.max(current, ...STAGES.map(([k], i) => (seen.has(k) ? i : -1)));
  return STAGES.map(([key, label], i) => {
    const last = [...events].reverse().find((e) => e.stage === key);
    let status: TodoItem["status"] = "pending";
    if (job.status === "done" || i < reached) status = "completed";
    else if (i === reached) status = job.status === "error" ? "cancelled" : "in-progress";
    return {
      id: key,
      title: label,
      status,
      detail: status === "in-progress" && last ? <span className="block max-w-[11rem] truncate sm:max-w-[13rem]">{last.msg}</span> : undefined,
    };
  });
}

function Placeholder({ planned, stage }: { planned: boolean; stage: string }) {
  const frames = Array.from({ length: 6 });
  return (
    <>
      {!planned && (
        <div className="rounded-2xl border border-border bg-background/50 p-4">
          <TextShimmer className="text-xs">The director is writing the script…</TextShimmer>
          <div className="mt-4 flex flex-col gap-3">
            {[92, 78, 86, 64, 80].map((w, i) => (
              <div key={i} className="flex gap-3">
                <span className="h-3 w-5 shrink-0 animate-pulse rounded bg-muted" />
                <span className="h-3 animate-pulse rounded bg-muted" style={{ width: `${w}%`, animationDelay: `${i * 120}ms` }} />
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="rounded-2xl border border-dashed border-border-strong bg-background/30 p-2">
        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
          {frames.map((_, i) => (
            <div key={i} className="aspect-video animate-pulse rounded-lg bg-muted" style={{ animationDelay: `${i * 90}ms` }} />
          ))}
        </div>
        <p className="px-1 pt-2 text-xs text-muted-foreground">
          {stage === "character" ? "Designing the character…" : stage === "keyframes" ? "Painting the keyframes…" : "Character sheet and keyframes will appear here"}
        </p>
      </div>
    </>
  );
}

export function JobPanel({ job, events, onResume }: Props) {
  const running = job.status === "running" || job.status === "queued";
  const [now, setNow] = useState(() => Date.now() / 1000);
  const [view, setView] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now() / 1000), 250);
    return () => clearInterval(t);
  }, [running]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [events.length]);

  const plan = [...events].reverse().find((e) => e.plan)?.plan;
  const media = events.filter((e) => e.images?.length || e.videos?.length).reverse();
  const last = events[events.length - 1];
  const elapsed = running ? now - job.created : (last?.t ?? 0);

  const items = useMemo<LightboxItem[]>(() => {
    const out: LightboxItem[] = [];
    for (const e of media) {
      e.images?.forEach((u) => out.push({ url: u, kind: "image", caption: e.msg }));
      e.videos?.forEach((u) => out.push({ url: u, kind: "video", caption: e.msg }));
    }
    return out;
  }, [media, job.status, job.result]);
  const openUrl = (url: string) => setView(Math.max(0, items.findIndex((i) => i.url === url)));

  return (
    <motion.section
      initial={{ opacity: 0, y: 16, filter: "blur(8px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ duration: 0.5, ease: EASE_OUT }}
      className="rounded-3xl border border-border bg-card/40 p-5 sm:p-8"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">{running ? "In production" : job.status === "done" ? "Latest film" : "Stopped"}</p>
          <h2 className="mt-1 truncate text-2xl font-medium tracking-tight">{plan ? `${plan.title} ${plan.subtitle}` : job.topic}</h2>
        </div>
        <AgentProgress
          label={job.status === "done" ? "Finished" : job.status === "error" ? "Stopped" : (STAGES.find(([k]) => k === job.stage)?.[1] ?? "Queued")}
          elapsedSeconds={elapsed}
          running={running}
        />
      </div>

      <AnimatePresence>
        {job.status === "done" && job.result && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            transition={{ duration: 0.5, ease: EASE_OUT }}
            className="overflow-hidden"
          >
            <FilmPlayer src={job.result.video} cleanSrc={job.result.clean} poster={job.result.poster} className="mt-6 border border-border" />
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">{job.result.duration} s · stored on fal</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="md"
                  disabled={saving}
                  onClick={async () => {
                    setSaving(true);
                    try {
                      await downloadFile(job.result!.video, `${job.project || job.id}.mp4`);
                    } finally {
                      setSaving(false);
                    }
                  }}
                >
                  <Download className="size-4" /> {saving ? "Saving…" : "Download"}
                </Button>
                <Button size="md" onClick={() => navigate(`/films/${job.id}`)}>
                  <Share2 className="size-4" /> {SHARING ? "Watch & share" : "Open the film page"}
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {job.status === "error" && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <p className="min-w-0 flex-1">{job.error || last?.msg}</p>
          {job.resumable && onResume && (
            <Button size="sm" variant="outline" onClick={onResume}>
              Resume from the last step
            </Button>
          )}
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,320px)_1fr]">
        <div className="flex min-w-0 flex-col gap-4">
          <TodoList items={stageItems(job, events)} title="Pipeline" collapseOnComplete={false} maxHeight={420} />
          <div ref={logRef} className="max-h-64 overflow-y-auto rounded-2xl border border-border bg-background/50 p-3 font-mono text-[11.5px] leading-relaxed">
            {events.map((e, i) => (
              <div key={i} className={cn("flex gap-2", e.stage === "error" ? "text-destructive" : "text-muted-foreground")}>
                <span className="shrink-0 opacity-60">{clock(e.t)}</span>
                {i === events.length - 1 && running ? <TextShimmer className="min-w-0">{e.msg}</TextShimmer> : <span className="min-w-0">{e.msg}</span>}
              </div>
            ))}
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          {plan && (
            <motion.div
              initial={{ opacity: 0, y: 8, filter: "blur(6px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{ duration: 0.4, ease: EASE_OUT }}
              className="rounded-2xl border border-border bg-background/50 p-4"
            >
              <p className="text-xs text-muted-foreground">
                Script · narrated by <span className="text-foreground">{plan.character.name}</span>
              </p>
              <ol className="mt-3 flex max-h-72 flex-col gap-2 overflow-y-auto pr-1 text-sm leading-relaxed">
                {plan.blocks.map((b, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="mt-0.5 w-5 shrink-0 font-mono text-xs text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
                    <span className={cn(b.kind === "T" ? "text-foreground" : "text-muted-foreground")}>
                      {b.kind === "T" && <Mic className="mr-1.5 inline size-3.5 -translate-y-px text-accent" />}
                      {b.text}
                    </span>
                  </li>
                ))}
              </ol>
            </motion.div>
          )}

          {media.length === 0 && job.status !== "error" && <Placeholder planned={!!plan} stage={job.stage} />}

          <AnimatePresence initial={false}>
            {media.map((e, i) => (
              <motion.figure
                key={`${e.t}-${i}`}
                layout
                initial={{ opacity: 0, y: -8, filter: "blur(8px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                transition={{ duration: 0.45, ease: EASE_OUT }}
                className="overflow-hidden rounded-2xl border border-border bg-background/50 p-2"
              >
                <div className={cn("grid gap-1.5", (e.images?.length ?? 0) + (e.videos?.length ?? 0) > 2 ? "grid-cols-3 sm:grid-cols-4" : "grid-cols-2")}>
                  {e.images?.map((u) => (
                    <button key={u} type="button" onClick={() => openUrl(u)} className="overflow-hidden rounded-lg bg-muted" aria-label="Preview image">
                      <img src={u} alt="" loading="lazy" className="aspect-video w-full object-cover transition-transform duration-300 hover:scale-105" />
                    </button>
                  ))}
                  {e.videos?.map((u) => (
                    <button key={u} type="button" onClick={() => openUrl(u)} className="group relative overflow-hidden rounded-lg bg-black" aria-label="Preview shot">
                      <video src={u} muted loop playsInline autoPlay preload="metadata" className="aspect-video w-full object-cover" />
                      <span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
                        <FilmIcon className="size-5 text-white drop-shadow" />
                      </span>
                    </button>
                  ))}
                </div>
                <figcaption className="px-1 pt-2 text-xs text-muted-foreground">{e.msg}</figcaption>
              </motion.figure>
            ))}
          </AnimatePresence>
        </div>
      </div>

      <Lightbox items={items} index={view} onIndex={setView} onClose={() => setView(null)} />
    </motion.section>
  );
}
