import { motion } from "motion/react";
import { ArrowLeft, Check, ChevronDown, Download, Eye, Film as FilmIcon, Flag, Languages, Link2, Share2, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { setAgentContext } from "@/lib/agent";
import { AgentPromptButton } from "@/components/app/agent-button";
import { FilmPlayer } from "@/components/app/film-player";
import { fmtDuration } from "@/components/app/film-card";
import { Lightbox, downloadFile, type LightboxItem } from "@/components/app/lightbox";
import { ShareDialog } from "@/components/app/share-dialog";
import { Button } from "@/components/motion/button/base";
import { EASE_OUT } from "@/lib/ease";
import { Link, navigate } from "@/lib/router";
import { cn } from "@/lib/utils";
import { STAGES, clock, languageName, nativeLanguage, type CastMember, type Film } from "@/lib/api";
import { SHARING, ShareError, countView, isSharedId, ownedFilm, report, sharedCopy, sharedFilm } from "@/lib/share";

const STAGE_LABEL: Record<string, string> = { ...Object.fromEntries(STAGES), done: "Done" };

const CREDITS = (voice: string) => [
  { role: "Story & direction", who: "Claude Opus 5.5", note: "script, shot plan and a second editing pass for flow" },
  { role: "Characters & keyframes", who: "GPT Image 2.5", note: "model sheet, portrait and one painted frame per scene" },
  { role: "Animation", who: "MiniMax H3 Max", note: "reference-to-video shots and lip-synced talking shots, 768p" },
  { role: "Narration", who: "ElevenLabs v3", note: voice ? `voice: ${voice}` : "Voice Library voice" },
  { role: "Score", who: "ElevenLabs Music", note: "instrumental, written for this film" },
  { role: "Edit, mix & subtitles", who: "fal ffmpeg-api · workflow-utilities", note: "trim, merge, compose, loudness, word-by-word captions" },
];

const ago = (created: number) => {
  const d = Math.max(0, Date.now() / 1000 - created);
  if (d < 3600) return `${Math.max(1, Math.round(d / 60))} min ago`;
  if (d < 86400) return `${Math.round(d / 3600)} h ago`;
  return new Date(created * 1000).toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric" });
};

const Quote = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden className={className}>
    <path d="M10 5c0 4.2-2.3 8.7-6.8 11.6-.5.3-1.1-.2-.8-.7 1-1.8 1.5-3.4 1.6-4.9A4.2 4.2 0 1 1 10 5Zm11 0c0 4.2-2.3 8.7-6.8 11.6-.5.3-1.1-.2-.8-.7 1-1.8 1.5-3.4 1.6-4.9A4.2 4.2 0 1 1 21 5Z" fill="currentColor" />
  </svg>
);

function StoryCard({ film }: { film: Film }) {
  return (
    <Link to={`/films/${film.id}`} className="group flex min-w-0 flex-col gap-2">
      <div className="relative aspect-video overflow-hidden rounded-xl bg-black ring-1 ring-border">
        {(film.thumb || film.poster) && (
          <img src={film.thumb || film.poster!} alt="" loading="lazy" className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" />
        )}
        <span className="absolute top-1.5 left-1.5 rounded-full bg-black/65 px-1.5 py-px text-[10px] font-medium text-white backdrop-blur-sm">{nativeLanguage(film.lang)}</span>
        <span className="absolute right-1.5 bottom-1.5 rounded bg-black/70 px-1 py-px font-mono text-[10px] text-white">{fmtDuration(film.duration)}</span>
      </div>
      <p className="line-clamp-2 text-[13px] leading-snug">
        <span className="font-medium">{film.title}</span> <span className="text-muted-foreground">{film.subtitle}</span>
      </p>
    </Link>
  );
}

const REASONS = ["Inappropriate", "Spam", "Copyright", "Something else"];

function ReportButton({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  if (sent) return <span className="self-center text-xs text-muted-foreground">Thanks, reported</span>;
  return (
    <div className="relative">
      <Button variant="ghost" size="icon" className="rounded-full border border-border" aria-label="Report" onClick={() => setOpen((o) => !o)}>
        <Flag className="size-4" />
      </Button>
      {open && (
        <div className="absolute top-12 right-0 z-20 flex w-48 flex-col rounded-2xl border border-border bg-card p-1.5 shadow-xl">
          <p className="px-2.5 py-1.5 text-xs text-muted-foreground">Report this story</p>
          {REASONS.map((r) => (
            <button
              key={r}
              type="button"
              className="rounded-xl px-2.5 py-2 text-left text-sm hover:bg-muted"
              onClick={() => {
                setOpen(false);
                report(id, r).then(() => setSent(true)).catch(() => setSent(true));
              }}
            >
              {r}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function WatchPage({ id, films, cast, loading }: { id: string; films: Film[]; cast: CastMember[]; loading: boolean }) {
  const [remote, setRemote] = useState<{ id: string; film: Film | null; code?: string } | null>(null);
  useEffect(() => {
    if (!isSharedId(id)) return;
    let live = true;
    sharedFilm(id)
      .then((f) => live && setRemote({ id, film: f }))
      .catch((e) => live && setRemote({ id, film: null, code: e instanceof ShareError ? e.code : "" }));
    countView(id);
    return () => {
      live = false;
    };
  }, [id]);
  const fromApi = remote?.id === id ? remote.film : undefined;
  const film = fromApi ?? films.find((x) => x.id === id);
  const waiting = isSharedId(id) && remote?.id !== id;
  const [shareOpen, setShareOpen] = useState(false);
  const [, setTick] = useState(0);
  const [story, setStory] = useState(false);
  const [log, setLog] = useState(false);
  const [view, setView] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setStory(false);
    setLog(false);
    setView(null);
  }, [id]);
  useEffect(() => {
    setAgentContext(film ? { kind: "film", film } : null);
    return () => setAgentContext(null);
  }, [film]);
  useEffect(() => {
    if (film) document.title = `${film.title} ${film.subtitle} · Storycast`;
    return () => {
      document.title = "Storycast";
    };
  }, [film]);

  const narrator = film && (cast.find((c) => c.id === film.character_id) ?? cast.find((c) => c.name === film.narrator));
  const { sameNarrator, more } = useMemo(() => {
    if (!film) return { sameNarrator: [] as Film[], more: [] as Film[] };
    const others = films.filter((x) => x.id !== film.id);
    const same = others.filter((x) => x.narrator === film.narrator);

    const score = (x: Film) => (x.style === film.style ? 2 : 0) + (x.lang === film.lang ? 1 : 0);
    const rest = others.filter((x) => x.narrator !== film.narrator).sort((a, b) => score(b) - score(a) || b.created - a.created);
    return { sameNarrator: same, more: rest.slice(0, 12) };
  }, [film, films]);

  if (!film) {
    return loading || waiting ? (
      <div className="grid gap-8 pt-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="aspect-video animate-pulse rounded-3xl bg-muted" />
        <div className="hidden grid-cols-2 gap-3 lg:grid">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="aspect-video animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      </div>
    ) : (
      <div className="flex flex-col items-center gap-4 py-24 text-center">
        <FilmIcon className="size-8 text-muted-foreground" />
        <p className="text-lg font-medium">
          {remote?.code === "in_review" ? "This story is waiting for review" : isSharedId(id) ? "This story is no longer shared" : "This film is not in the library"}
        </p>
        {remote?.code === "in_review" && <p className="-mt-2 text-sm text-muted-foreground">It can be watched as soon as it has been approved.</p>}
        <Button variant="secondary" onClick={() => navigate("/films")}>
          <ArrowLeft className="size-4" /> Back to all films
        </Button>
      </div>
    );
  }

  const talk = film.kinds.filter((k) => k === "T").length;
  const made = film.events.length ? film.events[film.events.length - 1].t : 0;
  const items: LightboxItem[] = film.keyframes.map((k, i) => ({ url: k, kind: "image" as const, caption: `Keyframe ${i + 1}` }));
  const firstName = narrator?.name.split(" ").pop();
  const voice = film.voice.split(" - ")[0];
  const mineShared = film.mine ? sharedCopy(film.id) : film.community ? ownedFilm(film.id) : null;
  const canShare = SHARING && (film.mine || !!mineShared);

  return (
    <div className="grid gap-x-10 gap-y-12 pt-8 lg:grid-cols-[minmax(0,1fr)_360px]">
      <motion.main key={film.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE_OUT }} className="min-w-0">

        <div className="relative isolate">
          {film.poster && (
            <img
              src={film.thumb || film.poster}
              alt=""
              aria-hidden
              className="pointer-events-none absolute inset-0 -z-10 size-full object-cover opacity-50 blur-3xl saturate-150"
            />
          )}
          <FilmPlayer key={film.id} src={film.video} cleanSrc={film.clean} poster={film.poster} autoPlay className="overflow-hidden rounded-3xl shadow-2xl ring-1 ring-white/10" />
        </div>

        <header className="mt-8 flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Link
                to={`/films?lang=${film.lang}`}
                title={`All films in ${languageName(film.lang)}`}
                className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-2.5 py-1 font-medium text-primary transition-colors hover:bg-primary/25"
              >
                <Languages className="size-3.5" /> {nativeLanguage(film.lang)}
                {film.lang !== "en" && <span className="font-normal opacity-75">· {languageName(film.lang)}</span>}
              </Link>
              <Link
                to={`/films?style=${film.style}`}
                title={`All ${film.style_label} films`}
                className="rounded-full border border-border px-2.5 py-1 text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
              >
                {film.style_label}
              </Link>
              <span className="font-mono text-muted-foreground">{fmtDuration(film.duration)}</span>
              <span className="text-muted-foreground">· {ago(film.created)}</span>
              {film.community && (
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  · <Eye className="size-3.5" /> {film.views ?? 0}
                </span>
              )}
              {(film.status === "pending" || film.in_review) && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">Waiting for review · only you can see it</span>
              )}
              {film.status === "unlisted" && <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">Unlisted</span>}
            </div>
            <h1 className="mt-3 text-3xl leading-tight font-semibold tracking-tight sm:text-4xl">{film.title}</h1>
            <p className="mt-1 text-lg text-muted-foreground sm:text-xl">{film.subtitle}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <AgentPromptButton />
            {canShare && (
              <Button className="rounded-full" onClick={() => setShareOpen(true)}>
                <Share2 className="size-4" /> {mineShared ? "Shared" : "Share"}
              </Button>
            )}
            {film.community && !mineShared && <ReportButton id={film.id} />}
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full border border-border"
              aria-label="Copy link"
              onClick={async () => {
                await navigator.clipboard?.writeText(window.location.href).catch(() => {});
                setCopied(true);
                setTimeout(() => setCopied(false), 1600);
              }}
            >
              {copied ? <Check className="size-4" /> : <Link2 className="size-4" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full border border-border"
              aria-label="Download"
              disabled={saving}
              onClick={async () => {
                setSaving(true);
                try {
                  await downloadFile(film.video, `${film.title}-${film.id}.mp4`.replace(/\s+/g, "-").toLowerCase());
                } finally {
                  setSaving(false);
                }
              }}
            >
              <Download className={cn("size-4", saving && "animate-pulse")} />
            </Button>
          </div>
        </header>

        <blockquote className="mt-6 flex gap-3 border-l-0">
          <Quote className="size-7 shrink-0 text-[#FF7A2F]" />
          <p className="pt-0.5 text-lg leading-relaxed text-balance">{film.topic}</p>
        </blockquote>

        <section className="mt-8 flex flex-col gap-4 rounded-3xl border border-border bg-card p-3 sm:flex-row sm:items-center">
          <div className="h-28 w-24 shrink-0 overflow-hidden rounded-2xl bg-muted">
            {narrator && <img src={narrator.thumb} alt="" className="size-full object-cover object-top" />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Narrated by</p>
            <p className="mt-0.5 text-lg font-semibold tracking-tight">{film.narrator || "An original narrator"}</p>
            {narrator?.personality && <p className="text-sm text-muted-foreground">{narrator.personality}</p>}
            {voice && <p className="mt-1 text-xs text-muted-foreground">Voice · {voice}</p>}
          </div>
          {narrator && (
            <Button className="shrink-0 rounded-full sm:mr-2" onClick={() => navigate(`/create?character=${narrator.id}`)}>
              <Sparkles className="size-4" /> New film with {firstName}
            </Button>
          )}
        </section>

        {film.script.length > 0 && (
          <section className="mt-10">
            <h2 className="text-sm font-semibold tracking-tight">The story</h2>
            <div className={cn("relative mt-3", !story && "max-h-36 overflow-hidden")}>
              <ol className="flex flex-col gap-3">
                {film.script.map((t, i) => (
                  <li key={i} className="grid grid-cols-[2rem_1fr] gap-2 text-[15px] leading-relaxed">
                    <span className="pt-0.5 font-mono text-xs text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
                    <span>
                      {film.kinds[i] === "T" && (
                        <span className="mr-2 inline-block rounded-full bg-primary/15 px-2 py-px align-middle text-[10px] font-medium text-primary">on camera</span>
                      )}
                      {t}
                    </span>
                  </li>
                ))}
              </ol>
              {!story && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-background to-transparent" />}
            </div>
            <button type="button" onClick={() => setStory((m) => !m)} className="mt-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
              {story ? "Show less" : `Read all ${film.script.length} lines`} <ChevronDown className={cn("size-4 transition-transform", story && "rotate-180")} />
            </button>
          </section>
        )}

        <section className="mt-10 rounded-3xl border border-border bg-card p-5 sm:p-6">
          <h2 className="text-sm font-semibold tracking-tight">Behind the story</h2>
          <dl className="mt-4 grid grid-cols-2 gap-y-4 sm:grid-cols-4">
            {[
              ["Scenes", film.script.length + 1],
              ["On camera", talk],
              ["Voice-over", film.script.length - talk],
              ["Made in", made ? `${Math.max(1, Math.round(made / 60))} min` : "–"],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">{k}</dt>
                <dd className="mt-0.5 text-2xl font-medium tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>

          {film.keyframes.length > 0 && (
            <div className="scrollbar-hide -mx-1 mt-6 flex gap-2 overflow-x-auto px-1 pb-1">
              {film.keyframes.map((k, i) => (
                <button key={k} type="button" onClick={() => setView(i)} aria-label={`Keyframe ${i + 1}`} className="w-36 shrink-0 overflow-hidden rounded-xl ring-1 ring-border">
                  <img src={k} alt="" loading="lazy" className="aspect-video w-full object-cover transition-transform duration-300 hover:scale-105" />
                </button>
              ))}
            </div>
          )}

          <div className="mt-7">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Credits</p>
            <dl className="mt-3 divide-y divide-border">
              {CREDITS(voice).map((c) => (
                <div key={c.role} className="grid gap-x-6 gap-y-0.5 py-2.5 sm:grid-cols-[11rem_1fr]">
                  <dt className="text-sm text-muted-foreground">{c.role}</dt>
                  <dd className="text-sm">
                    <span className="font-medium">{c.who}</span> <span className="text-muted-foreground">· {c.note}</span>
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">Every frame, voice and cut was made on fal.</p>
          </div>

          {film.events.length > 0 && (
            <div className="mt-6">
              <button type="button" onClick={() => setLog((l) => !l)} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
                {log ? "Hide the production log" : "Show the production log"} <ChevronDown className={cn("size-4 transition-transform", log && "rotate-180")} />
              </button>
              {log && (
                <ol className="mt-3 flex flex-col gap-1.5">
                  {film.events.map((e, i) => (
                    <li key={i} className="grid grid-cols-[3rem_5.5rem_1fr] gap-2 text-[13px]">
                      <span className="font-mono text-muted-foreground">{clock(e.t)}</span>
                      <span className="text-muted-foreground">{STAGE_LABEL[e.stage] ?? e.stage}</span>
                      <span className="min-w-0">{e.msg}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
        </section>
        <Lightbox items={items} index={view} onIndex={setView} onClose={() => setView(null)} />
        {canShare && (
          <ShareDialog
            film={film}
            existing={mineShared}
            open={shareOpen}
            onClose={() => setShareOpen(false)}
            onChange={() => {
              setTick((t) => t + 1);

              if (film.community && !ownedFilm(film.id)) {
                setShareOpen(false);
                navigate("/films");
              }
            }}
          />
        )}
      </motion.main>

      <aside className="flex min-w-0 flex-col gap-8">
        {sameNarrator.length > 0 && (
          <div>
            <h2 className="mb-3 text-sm font-semibold tracking-tight">More from {film.narrator}</h2>
            <div className="grid grid-cols-2 gap-x-3 gap-y-5">
              {sameNarrator.map((x) => (
                <StoryCard key={x.id} film={x} />
              ))}
            </div>
          </div>
        )}
        <div>
          <h2 className="mb-3 text-sm font-semibold tracking-tight">Keep watching</h2>
          <div className="grid grid-cols-2 gap-x-3 gap-y-5">
            {more.map((x) => (
              <StoryCard key={x.id} film={x} />
            ))}
          </div>
          <Link to="/films" className="mt-5 block rounded-full border border-border py-2 text-center text-sm text-muted-foreground transition-colors hover:text-foreground">
            Browse all {films.length} films
          </Link>
        </div>
      </aside>
    </div>
  );
}
