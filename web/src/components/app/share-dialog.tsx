import { AnimatePresence, motion } from "motion/react";
import { Check, Clock, Copy, Download, Globe, Link2, Share2, ShieldCheck, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { downloadFile } from "@/components/app/lightbox";
import { createPortal } from "react-dom";
import { Button } from "@/components/motion/button/base";
import { EASE_OUT } from "@/lib/ease";
import { navigate } from "@/lib/router";
import { cn } from "@/lib/utils";
import type { Film } from "@/lib/api";
import { REPO_URL, ShareError, TURNSTILE_SITE_KEY, quota, setVisibility, shareFilm, unshare, type Owned, type Quota, type ShareStatus, type Visibility } from "@/lib/share";

type TurnstileApi = {
  render: (el: HTMLElement, o: Record<string, unknown>) => string;
  remove: (id: string) => void;
  reset: (id: string) => void;
};
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let turnstileScript: Promise<void> | null = null;
function loadTurnstile() {
  turnstileScript ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("could not load the bot check"));
    document.head.append(s);
  });
  return turnstileScript;
}

function Turnstile({ onToken }: { onToken: (t: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) {
      onToken("none");
      return;
    }
    let id: string | null = null;
    let gone = false;
    loadTurnstile()
      .then(() => {
        if (gone || !box.current || !window.turnstile) return;
        id = window.turnstile.render(box.current, {
          sitekey: TURNSTILE_SITE_KEY,
          theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
          size: "flexible",
          callback: (t: string) => onToken(t),
          "expired-callback": () => onToken(""),
        });
      })
      .catch(() => {});
    return () => {
      gone = true;
      if (id) window.turnstile?.remove(id);
    };
  }, [onToken]);
  return TURNSTILE_SITE_KEY ? <div ref={box} className="min-h-[65px]" /> : null;
}

const STATUS_NOTE: Record<ShareStatus, string> = {
  unlisted: "Anyone with the link can watch it.",
  pending: "Waiting for review. Once approved it is in Explore, and the link works for everyone.",
  public: "It is in Explore for everyone.",
  hidden: "This film was taken down.",
};
const IN_REVIEW_NOTE = "The automatic check wasn't sure about this one, so a person will take a quick look. The link works once it is approved.";

const GithubMark = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden className={className} fill="currentColor">
    <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.56-.29-5.25-1.28-5.25-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.7 5.39-5.27 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
  </svg>
);

const clockTime = (unix: number) => new Date(unix * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function LimitPanel({ film, q, onExplore }: { film: Film; q: Quota; onExplore: () => void }) {
  const [saving, setSaving] = useState(false);
  const row = "flex items-start gap-3 rounded-2xl border border-border p-3.5 text-left transition-colors hover:border-border-strong";
  const icon = "grid size-8 shrink-0 place-items-center rounded-full bg-muted";
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-2xl bg-muted/60 p-4">
        <p className="text-sm font-medium">You've shared {q.links_per_day} stories by link today</p>
        <p className="mt-1 text-xs text-muted-foreground">
          To keep Storycast safe from abuse, everyone can share up to {q.links_per_day} stories by link a day, and every shared story is
          checked automatically. You can still make as many films as you like.
        </p>
      </div>
      <button type="button" className={row} onClick={onExplore} disabled={q.explore_left <= 0}>
        <span className={icon}>
          <Globe className="size-4" />
        </span>
        <span>
          <span className="block text-sm font-medium">Send it to Explore instead</span>
          <span className="block text-xs text-muted-foreground">
            {q.explore_left > 0 ? "It is reviewed first, then everyone can watch it and the link works." : "You have also reached today's Explore limit."}
          </span>
        </span>
      </button>
      <button
        type="button"
        className={row}
        disabled={saving}
        onClick={async () => {
          setSaving(true);
          try {
            await downloadFile(film.video, `${film.title}-${film.subtitle}.mp4`.replace(/\s+/g, "-").toLowerCase());
          } finally {
            setSaving(false);
          }
        }}
      >
        <span className={icon}>
          <Download className="size-4" />
        </span>
        <span>
          <span className="block text-sm font-medium">{saving ? "Downloading…" : "Download the video"}</span>
          <span className="block text-xs text-muted-foreground">Keep the MP4 and send it anywhere yourself.</span>
        </span>
      </button>
      <div className={cn(row, "hover:border-border")}>
        <span className={icon}>
          <Clock className="size-4" />
        </span>
        <span>
          <span className="block text-sm font-medium">Wait a little</span>
          <span className="block text-xs text-muted-foreground">
            {q.links_reset_at ? `You can share by link again at ${clockTime(q.links_reset_at)}.` : "You can share by link again within 24 hours."}
          </span>
        </span>
      </div>
      <a href={REPO_URL} target="_blank" rel="noreferrer" className={row}>
        <span className={icon}>
          <GithubMark className="size-4" />
        </span>
        <span>
          <span className="block text-sm font-medium">Run your own Storycast</span>
          <span className="block text-xs text-muted-foreground">Fork the project on GitHub and host your own copy, with your own limits.</span>
        </span>
      </a>
    </div>
  );
}

function Choice({ active, onClick, icon, title, note }: { active: boolean; onClick: () => void; icon: React.ReactNode; title: string; note: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex items-start gap-3 rounded-2xl border p-4 text-left transition-colors",
        active ? "border-foreground bg-muted/60" : "border-border hover:border-border-strong",
      )}
    >
      <span className={cn("grid size-9 shrink-0 place-items-center rounded-full", active ? "bg-foreground text-background" : "bg-muted")}>{icon}</span>
      <span>
        <span className="block text-sm font-medium">{title}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{note}</span>
      </span>
    </button>
  );
}

export function ShareDialog({ film, existing, open, onClose, onChange }: { film: Film; existing: Owned | null; open: boolean; onClose: () => void; onChange: () => void }) {
  const [visibility, setVis] = useState<Visibility>("unlisted");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [q, setQ] = useState<Quota | null>(null);
  const [limited, setLimited] = useState(false);

  const [attempt, setAttempt] = useState(0);

  const loadQuota = useCallback(() => quota().then(setQ).catch(() => setQ(null)), []);
  useEffect(() => {
    if (!open) return;
    setError("");
    setLimited(false);
    setConfirmDelete(false);
    setVis(existing && existing.status !== "unlisted" ? "public" : "unlisted");
    loadQuota();
  }, [open, existing, loadQuota]);
  const onToken = useCallback((t: string) => setToken(t), []);

  const link = existing ? `${window.location.origin}/films/${existing.id}` : "";

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      onChange();
      loadQuota();
    } catch (e) {
      if (e instanceof ShareError && e.code === "link_limit") {
        await loadQuota();
        setLimited(true);
      } else if (e instanceof ShareError && e.code === "refused") {
        setError("This story can't be shared: it did not pass Storycast's safety check. You can still download it.");
      } else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setToken("");
      setAttempt((a) => a + 1);
    }
  }

  const noLinksLeft = visibility === "unlisted" && q !== null && q.links_left <= 0;

  const copy = async () => {
    await navigator.clipboard?.writeText(link).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-background/70 px-4 py-6 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => !busy && onClose()}
        >
          <motion.div
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.25, ease: EASE_OUT }}
            className="relative flex w-full max-w-md flex-col gap-5 rounded-3xl border border-border bg-card p-6 shadow-xl"
          >
            <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="absolute top-4 right-4 grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground">
              <X className="size-4" />
            </button>
            <div className="flex items-start gap-3 pr-8">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-muted">
                <Share2 className="size-4" />
              </span>
              <div className="min-w-0">
                <h2 className="text-base font-medium">{existing ? "Shared story" : "Share this story"}</h2>
                <p className="mt-1 truncate text-sm text-muted-foreground">
                  {film.title} {film.subtitle}
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Choice
                active={visibility === "unlisted"}
                onClick={() => (setVis("unlisted"), setLimited(false))}
                icon={<Link2 className="size-4" />}
                title="Anyone with the link"
                note={q ? `Only people you send the link to can find it. ${q.links_left} of ${q.links_per_day} links left today.` : "Only people you send the link to can find it."}
              />
              <Choice
                active={visibility === "public"}
                onClick={() => (setVis("public"), setLimited(false))}
                icon={<Globe className="size-4" />}
                title="Publish to Explore"
                note="Reviewed first, then everyone can find it and the link works."
              />
            </div>

            {existing ? (
              <>
                <div className="flex items-center gap-2 rounded-2xl border border-border p-1.5 pl-4">
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{link}</span>
                  <Button size="sm" variant="secondary" onClick={copy}>
                    {copied ? <Check className="size-4" /> : <Copy className="size-4" />} {copied ? "Copied" : "Copy"}
                  </Button>
                </div>
                <p className="-mt-2 text-xs text-muted-foreground">{existing.in_review ? IN_REVIEW_NOTE : STATUS_NOTE[existing.status]}</p>
                {limited && q && <LimitPanel film={film} q={q} onExplore={() => (setVis("public"), setLimited(false))} />}
                <div className="flex flex-wrap gap-2">
                  {!existing.in_review && existing.status !== "hidden" && (visibility === "public") !== (existing.status !== "unlisted") && (
                    <Button disabled={busy} onClick={() => run(() => setVisibility(existing.id, visibility))}>
                      {busy ? "Saving…" : visibility === "public" ? "Send to Explore" : "Take out of Explore"}
                    </Button>
                  )}
                  <Button variant="ghost" onClick={() => (onClose(), navigate(`/films/${existing.id}`))}>
                    Open the shared page
                  </Button>
                  <Button
                    variant="ghost"
                    className="ml-auto text-destructive"
                    disabled={busy}
                    onClick={() => (confirmDelete ? run(() => unshare(existing.id)) : setConfirmDelete(true))}
                  >
                    <Trash2 className="size-4" /> {confirmDelete ? "Delete for everyone?" : "Stop sharing"}
                  </Button>
                </div>
              </>
            ) : (
              <>
                {limited || noLinksLeft ? (
                  q && <LimitPanel film={film} q={q} onExplore={() => (setVis("public"), setLimited(false))} />
                ) : (
                  <>
                    <Turnstile key={attempt} onToken={onToken} />
                    <Button disabled={busy || !token} onClick={() => run(() => shareFilm(film, visibility, token))}>
                      {busy ? "Checking and sharing your story…" : visibility === "public" ? "Share and send to Explore" : "Create the link"}
                    </Button>
                    <p className="-mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
                      <ShieldCheck className="mt-px size-3.5 shrink-0" />
                      Every shared story is checked automatically for safety. The film is copied to Storycast so the link keeps working; your
                      fal key is never shared.
                    </p>
                  </>
                )}
              </>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
