import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, MessageSquareWarning, X } from "lucide-react";
import type { Film } from "@/lib/api";
import { reportIssue, ShareError } from "@/lib/share";
import { EASE_OUT } from "@/lib/ease";
import { cn } from "@/lib/utils";

const KINDS = [
  { id: "voice", label: "Voice" },
  { id: "edit", label: "Edit or timing" },
  { id: "picture", label: "Picture" },
  { id: "subtitles", label: "Subtitles" },
  { id: "story", label: "Story or facts" },
  { id: "other", label: "Something else" },
];

const stamp = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

export function IssueButton({ film }: { film: Film }) {
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("");
  const [note, setNote] = useState("");
  const [at, setAt] = useState(0);
  const [withTime, setWithTime] = useState(true);
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: PointerEvent) => root.current && !root.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  function toggle() {
    if (!open) {
      setAt(document.querySelector("video")?.currentTime ?? 0);
      setError("");
      if (state === "sent") {
        setState("idle");
        setKind("");
        setNote("");
      }
    }
    setOpen((o) => !o);
  }

  async function send() {
    if (!kind || state === "sending") return;
    setState("sending");
    setError("");
    try {
      await reportIssue(film, kind, note, withTime ? at : 0);
      setState("sent");
      setTimeout(() => setOpen(false), 1400);
    } catch (e) {
      setState("idle");
      setError(e instanceof ShareError ? e.message : "Could not send it, please try again");
    }
  }

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-label="Report a problem"
        title="Report a problem"
        className="grid size-10 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
      >
        <MessageSquareWarning className="size-4" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label="Report a problem"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.2, ease: EASE_OUT }}
            style={{ transformOrigin: "top right" }}
            className="absolute top-12 right-0 z-30 w-[min(20rem,calc(100vw-2rem))] rounded-2xl border border-border bg-card p-4 shadow-2xl shadow-black/30"
          >
            {state === "sent" ? (
              <div className="flex items-center gap-2 py-2 text-sm">
                <Check className="size-4 text-success" /> Thanks, it's on its way.
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">Report a problem</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">Something off with the voice, the cut or the picture? Tell us.</p>
                  </div>
                  <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="-mt-1 -mr-1 grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground">
                    <X className="size-3.5" />
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {KINDS.map((k) => (
                    <button
                      key={k.id}
                      type="button"
                      onClick={() => setKind(k.id)}
                      aria-pressed={kind === k.id}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-xs transition-colors",
                        kind === k.id ? "border-transparent bg-foreground text-background" : "border-border text-muted-foreground hover:border-border-strong hover:text-foreground",
                      )}
                    >
                      {k.label}
                    </button>
                  ))}
                </div>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value.slice(0, 1000))}
                  rows={3}
                  placeholder="What happened? (optional)"
                  className="mt-3 w-full resize-none rounded-xl border border-border bg-background/60 px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus:border-border-strong"
                />
                {at > 0 && (
                  <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                    <input type="checkbox" checked={withTime} onChange={(e) => setWithTime(e.target.checked)} className="accent-current" />
                    At {stamp(at)} in the film
                  </label>
                )}
                {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
                <button
                  type="button"
                  onClick={send}
                  disabled={!kind || state === "sending"}
                  className="mt-3 inline-flex h-9 w-full items-center justify-center rounded-full bg-foreground text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  {state === "sending" ? "Sending…" : "Send"}
                </button>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
