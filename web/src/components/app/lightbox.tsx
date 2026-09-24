import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronLeft, ChevronRight, Download, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { FilmPlayer } from "@/components/app/film-player";
import { SPRING_PANEL } from "@/lib/ease";
import { cn } from "@/lib/utils";

export type LightboxItem = { url: string; kind: "image" | "video"; caption?: string };

export async function downloadFile(url: string, name?: string) {
  const blob = await fetch(url).then((r) => r.blob());
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = name || url.split("/").pop() || "download";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

export function Lightbox({ items, index, onIndex, onClose }: { items: LightboxItem[]; index: number | null; onIndex: (i: number) => void; onClose: () => void }) {
  const reduce = useReducedMotion();
  const [dir, setDir] = useState(0);
  const open = index !== null && items[index] !== undefined;
  const item = open ? items[index] : null;

  const step = useCallback(
    (d: number) => {
      if (index === null || items.length < 2) return;
      setDir(d);
      onIndex((index + d + items.length) % items.length);
    },
    [index, items.length, onIndex],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose, step]);

  return createPortal(
    <AnimatePresence>
      {item && (
        <motion.div
          key="lightbox"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[90] flex flex-col bg-background/80 [backdrop-filter:blur(18px)_saturate(140%)]"
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label="Preview"
        >
          <div className="flex items-center justify-between gap-3 px-4 py-3" onClick={(e) => e.stopPropagation()}>
            <p className="min-w-0 truncate text-sm text-muted-foreground">
              {items.length > 1 && <span className="mr-2 font-mono text-xs">{index! + 1} / {items.length}</span>}
              {item.caption}
            </p>
            <div className="flex shrink-0 items-center gap-1">
              <button type="button" onClick={() => downloadFile(item.url)} aria-label="Download" className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground">
                <Download className="size-4" />
              </button>
              <button type="button" onClick={onClose} aria-label="Close preview" className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground">
                <X className="size-4" />
              </button>
            </div>
          </div>

          <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 pb-6 sm:px-16">
            <AnimatePresence mode="popLayout" initial={false} custom={dir}>
              <motion.div
                key={item.url}
                custom={dir}
                initial={reduce ? { opacity: 0 } : { opacity: 0, x: dir * 40, scale: 0.98, filter: "blur(6px)" }}
                animate={{ opacity: 1, x: 0, scale: 1, filter: "blur(0px)" }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, x: dir * -40, scale: 0.98, filter: "blur(6px)" }}
                transition={SPRING_PANEL}
                className="flex max-h-full max-w-full items-center justify-center"
                onClick={(e) => e.stopPropagation()}
              >
                {item.kind === "video" ? (
                  <div className="w-[min(92vw,calc((100dvh-8rem)*16/9))] shadow-2xl">
                    <FilmPlayer src={item.url} autoPlay />
                  </div>
                ) : (
                  <img src={item.url} alt={item.caption ?? ""} className="max-h-[calc(100dvh-7rem)] max-w-full rounded-2xl object-contain shadow-2xl" />
                )}
              </motion.div>
            </AnimatePresence>

            {items.length > 1 &&
              ([-1, 1] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    step(d);
                  }}
                  aria-label={d < 0 ? "Previous" : "Next"}
                  className={cn(
                    "absolute top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card/80 text-foreground backdrop-blur-md transition-colors hover:bg-card",
                    d < 0 ? "left-3 sm:left-5" : "right-3 sm:right-5",
                  )}
                >
                  {d < 0 ? <ChevronLeft className="size-5" /> : <ChevronRight className="size-5" />}
                </button>
              ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
