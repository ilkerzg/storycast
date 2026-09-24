import { useCallback, useEffect, useState } from "react";
import { CreateForm } from "@/components/app/create-form";
import { FilmsPage } from "@/components/app/films-page";
import { WatchPage } from "@/components/app/watch-page";
import { Gallery } from "@/components/app/gallery";
import { Header } from "@/components/app/header";
import { Hero } from "@/components/app/hero";
import { JobPanel } from "@/components/app/job-panel";
import { AnimatedToastStack, useAnimatedToastStack } from "@/components/motion/animated-toast-stack";
import { KeyDialog } from "@/components/app/key-dialog";
import { AgentPromptButton } from "@/components/app/agent-button";
import { community } from "@/lib/share";
import { api, toJob, type Config, type Film, type Job, type JobEvent, type NewJob } from "@/lib/api";
import { clearFalKey, falKey, onKeyChange } from "@/lib/studio/fal";
import { saveRecord, type FilmRecord } from "@/lib/studio/store";
import { navigate, usePath } from "@/lib/router";
import { TextReveal } from "@/components/motion/text-reveal";

const JOB_KEY = "storycast-job";

function remember(id: string | null) {
  try {
    if (id) localStorage.setItem(JOB_KEY, id);
    else localStorage.removeItem(JOB_KEY);
  } catch {}
}

export default function App() {
  const [config, setConfig] = useState<Config | null>(null);
  const [films, setFilms] = useState<Film[]>([]);
  const [filmsLoading, setFilmsLoading] = useState(true);
  const [shared, setShared] = useState<Film[]>([]);
  const path = usePath();
  const [job, setJob] = useState<Job | null>(null);
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [hasKey, setHasKey] = useState(() => !!falKey());
  const [keyOpen, setKeyOpen] = useState(false);
  useEffect(() => onKeyChange(() => setHasKey(!!falKey())), []);
  useEffect(() => {
    const need = () => setKeyOpen(true);
    window.addEventListener("storycast:need-key", need);
    return () => window.removeEventListener("storycast:need-key", need);
  }, []);
  const { toasts, showToast, dismissToast } = useAnimatedToastStack({ limit: 3 });

  const loadFilms = useCallback(
    () =>
      Promise.all([
        api.films().then(setFilms).catch(() => {}),
        community()
          .then((list) => setShared(list.map((f) => ({ ...f, community: true }))))
          .catch(() => {}),
      ]).finally(() => setFilmsLoading(false)),
    [],
  );
  const everything = [...films, ...shared];

  const show = useCallback((rec: FilmRecord) => {
    setJob(toJob(rec));
    setEvents([...(rec.events || [])]);
  }, []);

  const follow = useCallback(
    async (rec: FilmRecord, done: Promise<FilmRecord>) => {
      remember(rec.id);
      show(rec);
      const final = await done;
      show(final);
      if (final.status === "done") {
        showToast({ status: "success", title: "Your film is ready", description: final.result?.title, duration: 8000 });
        loadFilms();
      } else {
        if (/401|403|key/i.test(final.error || "")) setKeyOpen(true);
        showToast({ status: "error", title: "Production stopped", description: final.error?.slice(0, 140), duration: 8000 });
      }
    },
    [loadFilms, show, showToast],
  );

  const onEvent = useCallback((e: JobEvent, rec: FilmRecord) => {
    setEvents((prev) => [...prev, e]);
    setJob(toJob(rec));
  }, []);

  useEffect(() => {
    api
      .config()
      .then(setConfig)
      .catch(() => showToast({ status: "error", title: "Could not load the studio data" }));
    loadFilms();
    let last: string | null = null;
    try {
      last = localStorage.getItem(JOB_KEY);
    } catch {}
    if (!last) return;
    api
      .job(last)
      .then(async (rec) => {
        if (rec.status === "running" || rec.status === "queued") {
          rec.status = "error";
          rec.error = "Stopped because the tab was closed or reloaded. Everything finished so far is kept.";
          await saveRecord(rec);
        }
        show(rec);
      })
      .catch(() => remember(null));
  }, [loadFilms, show, showToast]);

  const busy = job?.status === "running" || job?.status === "queued";

  useEffect(() => {
    if (!busy) return;
    const guard = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [busy]);

  async function start(body: NewJob) {
    if (!falKey()) {
      setKeyOpen(true);
      throw new Error("Connect your fal key first");
    }
    const { rec, done } = await api.create(body, onEvent);
    if (!window.location.pathname.startsWith("/create")) navigate("/create");
    follow(rec, done);
    showToast({ status: "loading", title: "Production started", description: "Keep this tab open while the film is made", duration: 6000 });
    requestAnimationFrame(() => document.getElementById("production")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  async function resume() {
    if (!job) return;
    try {
      const { rec, done } = await api.resume(job.id, onEvent);
      follow(rec, done);
    } catch (e) {
      showToast({ status: "error", title: e instanceof Error ? e.message : String(e) });
    }
  }

  const production = job ? (
    <div id="production" className="scroll-mt-24">
      <JobPanel job={job} events={events} onResume={resume} />
    </div>
  ) : null;

  return (
    <div className="min-h-dvh">
      <Header hasKey={hasKey} onKey={() => setKeyOpen(true)} onDisconnect={() => (clearFalKey(), showToast({ status: "success", title: "fal key removed from this browser", duration: 3000 }))} />
      <main className="mx-auto flex max-w-7xl flex-col gap-10 px-4 pb-24 sm:px-6">
        {path.startsWith("/films/") ? (
          <WatchPage id={decodeURIComponent(path.slice("/films/".length))} films={everything} cast={config?.characters ?? []} loading={filmsLoading} />
        ) : path.startsWith("/films") ? (
          <FilmsPage films={everything} loading={filmsLoading} cast={config?.characters ?? []} />
        ) : path.startsWith("/create") ? (
          <div className="flex flex-col gap-6 pt-8">
            <header className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h1 className="text-3xl font-medium tracking-tight">
                  <TextReveal text="Make a film" />
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">Pick a topic, a look and a voice. The rest is directed for you.</p>
              </div>
              <AgentPromptButton />
            </header>
            {job && busy && production}
            {config ? (
              <CreateForm config={config} busy={busy} onStart={start} onError={(message) => showToast({ status: "error", title: message })} />
            ) : (
              <div className="h-96 animate-pulse rounded-3xl border border-border bg-card/40" />
            )}
            {job && !busy && production}
          </div>
        ) : (
          <>
            <Hero cast={config?.characters ?? []} films={films} />
            <Gallery films={films} />
          </>
        )}
      </main>
      <footer className="border-t border-border py-8 text-center text-xs text-muted-foreground">Storycast · every frame, voice and cut is made on fal</footer>
      <KeyDialog
        open={keyOpen}
        onClose={() => setKeyOpen(false)}
        onConnected={() => {
          setKeyOpen(false);
          showToast({ status: "success", title: "fal key connected", description: "You can make films now", duration: 4000 });
        }}
      />
      <AnimatedToastStack toasts={toasts} onDismiss={dismissToast} position="bottom-right" fixed portal />
    </div>
  );
}
