import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Captions, Loader2, Maximize, Minimize, Pause, PictureInPicture2, Play, RotateCcw, Volume1, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { EASE_OUT, SPRING_PRESS } from "@/lib/ease";
import { cn } from "@/lib/utils";

const SPEEDS = [1, 1.25, 1.5, 2, 0.75];

function fmt(t: number) {
  if (!Number.isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  return `${m}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
}

type Props = {
  src: string;
  cleanSrc?: string | null;
  poster?: string | null;
  autoPlay?: boolean;
  className?: string;
};

export function FilmPlayer({ src, cleanSrc, poster, autoPlay = false, className }: Props) {
  const reduce = useReducedMotion();
  const root = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<number | undefined>(undefined);
  const resume = useRef<{ t: number; play: boolean } | null>(null);

  const [subs, setSubs] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(autoPlay);
  const [waiting, setWaiting] = useState(false);
  const [ended, setEnded] = useState(false);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [full, setFull] = useState(false);
  const [idle, setIdle] = useState(false);
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const [flash, setFlash] = useState<{ id: number; icon: "play" | "pause" | "back" | "fwd" } | null>(null);

  const current = cleanSrc && !subs ? cleanSrc : src;

  const poke = useCallback(() => {
    setIdle(false);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setIdle(true), 2400);
  }, []);
  useEffect(() => () => window.clearTimeout(hideTimer.current), []);

  const toggle = useCallback(() => {
    const v = video.current;
    if (!v) return;
    setStarted(true);
    if (v.paused || v.ended) {
      void v.play();
      setFlash({ id: Date.now(), icon: "play" });
    } else {
      v.pause();
      setFlash({ id: Date.now(), icon: "pause" });
    }
  }, []);

  const seek = useCallback((t: number) => {
    const v = video.current;
    if (!v || !Number.isFinite(v.duration)) return;
    v.currentTime = Math.min(Math.max(0, t), v.duration);
    setTime(v.currentTime);
  }, []);

  const skip = useCallback(
    (d: number) => {
      seek((video.current?.currentTime ?? 0) + d);
      setFlash({ id: Date.now(), icon: d < 0 ? "back" : "fwd" });
    },
    [seek],
  );

  const fullscreen = useCallback(() => {
    const el = root.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  }, []);

  const swapSubs = useCallback(() => {
    const v = video.current;
    if (!cleanSrc || !v) return;
    resume.current = { t: v.currentTime, play: !v.paused };
    setSubs((s) => !s);
  }, [cleanSrc]);

  useEffect(() => {
    const on = () => setFull(document.fullscreenElement === root.current);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);

  useEffect(() => {
    if (video.current) {
      video.current.volume = volume;
      video.current.muted = muted;
    }
  }, [volume, muted]);
  useEffect(() => {
    if (video.current) video.current.playbackRate = speed;
  }, [speed, current]);

  function onKey(e: React.KeyboardEvent) {
    const k = e.key.toLowerCase();
    const map: Record<string, () => void> = {
      " ": toggle,
      k: toggle,
      j: () => skip(-5),
      arrowleft: () => skip(-5),
      l: () => skip(5),
      arrowright: () => skip(5),
      f: fullscreen,
      m: () => setMuted((m) => !m),
      c: swapSubs,
      arrowup: () => setVolume((v) => Math.min(1, v + 0.1)),
      arrowdown: () => setVolume((v) => Math.max(0, v - 0.1)),
    };
    if (map[k]) {
      e.preventDefault();
      e.stopPropagation();
      map[k]();
      poke();
    }
  }

  const tAt = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect();
    const x = Math.min(Math.max(0, clientX - r.left), r.width);
    return { x, t: (x / r.width) * (dur || 0) };
  };
  const onBarDown = (e: RPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setScrubbing(true);
    seek(tAt(e.clientX).t);
  };
  const onBarMove = (e: RPointerEvent<HTMLDivElement>) => {
    const p = tAt(e.clientX);
    setHover(p);
    if (scrubbing) seek(p.t);
  };

  const pct = dur ? (time / dur) * 100 : 0;
  const bufPct = dur ? (buffered / dur) * 100 : 0;
  const showChrome = !started || !playing || !idle || scrubbing || hover !== null;
  const VolIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  return (
    <div
      ref={root}
      tabIndex={0}
      onKeyDown={onKey}
      onMouseMove={poke}
      onMouseLeave={() => playing && setIdle(true)}
      className={cn(
        "group/player relative isolate aspect-video w-full overflow-hidden rounded-2xl bg-black outline-none ring-primary/50 focus-visible:ring-2",
        full && "rounded-none",
        !showChrome && "cursor-none",
        className,
      )}
    >
      <video
        ref={video}
        src={current}
        poster={poster ?? undefined}
        autoPlay={autoPlay}
        playsInline
        preload="metadata"
        onClick={toggle}
        onDoubleClick={fullscreen}
        onPlay={() => {
          setPlaying(true);
          setEnded(false);
          poke();
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setEnded(true);
        }}
        onWaiting={() => setWaiting(true)}
        onPlaying={() => setWaiting(false)}
        onCanPlay={() => setWaiting(false)}
        onTimeUpdate={(e) => !scrubbing && setTime(e.currentTarget.currentTime)}
        onDurationChange={(e) => setDur(e.currentTarget.duration)}
        onProgress={(e) => {
          const b = e.currentTarget.buffered;
          if (b.length) setBuffered(b.end(b.length - 1));
        }}
        onLoadedMetadata={(e) => {
          const v = e.currentTarget;
          setDur(v.duration);
          if (resume.current) {
            v.currentTime = resume.current.t;
            if (resume.current.play) void v.play();
            resume.current = null;
          }
        }}
        className="absolute inset-0 size-full object-contain"
      />

      <AnimatePresence>
        {(!started || ended) && (
          <motion.button
            type="button"
            onClick={() => (ended ? (seek(0), toggle()) : toggle())}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.1 }}
            whileTap={reduce ? undefined : { scale: 0.94 }}
            transition={SPRING_PRESS}
            aria-label={ended ? "Replay" : "Play"}
            className="absolute top-1/2 left-1/2 z-10 flex size-18 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-white shadow-2xl ring-1 ring-white/25 backdrop-blur-xl transition-colors hover:bg-white/25"
          >
            {ended ? <RotateCcw className="size-7" /> : <Play className="size-7 translate-x-0.5 fill-current" />}
          </motion.button>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {flash && started && !ended && (
          <motion.div
            key={flash.id}
            initial={{ opacity: 0.9, scale: 0.8 }}
            animate={{ opacity: 0, scale: 1.25 }}
            transition={{ duration: 0.5, ease: EASE_OUT }}
            onAnimationComplete={() => setFlash(null)}
            className={cn(
              "pointer-events-none absolute top-1/2 z-10 flex size-14 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-md",
              flash.icon === "back" ? "left-[18%]" : flash.icon === "fwd" ? "right-[18%]" : "left-1/2 -translate-x-1/2",
            )}
          >
            {flash.icon === "play" && <Play className="size-6 translate-x-0.5 fill-current" />}
            {flash.icon === "pause" && <Pause className="size-6 fill-current" />}
            {flash.icon === "back" && <span className="text-sm font-medium">−5s</span>}
            {flash.icon === "fwd" && <span className="text-sm font-medium">+5s</span>}
          </motion.div>
        )}
      </AnimatePresence>

      {waiting && started && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <Loader2 className="size-8 animate-spin text-white/80" />
        </div>
      )}

      <motion.div
        initial={false}
        animate={{ opacity: showChrome && started ? 1 : 0, y: showChrome && started ? 0 : 8 }}
        transition={{ duration: 0.25, ease: EASE_OUT }}
        className={cn("absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/75 via-black/30 to-transparent px-3 pt-10 pb-2.5 sm:px-4", !(showChrome && started) && "pointer-events-none")}
      >

        <div
          ref={bar}
          role="slider"
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.round(dur)}
          aria-valuenow={Math.round(time)}
          onPointerDown={onBarDown}
          onPointerMove={onBarMove}
          onPointerUp={() => setScrubbing(false)}
          onPointerLeave={() => !scrubbing && setHover(null)}
          className="group/bar relative flex h-4 cursor-pointer touch-none items-center"
        >
          <div className="relative h-1 w-full overflow-hidden rounded-full bg-white/20 transition-[height] duration-150 group-hover/bar:h-1.5">
            <div className="absolute inset-y-0 left-0 rounded-full bg-white/30" style={{ width: `${bufPct}%` }} />
            {hover && <div className="absolute inset-y-0 left-0 bg-white/25" style={{ width: `${(hover.t / (dur || 1)) * 100}%` }} />}
            <div className="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: `${pct}%` }} />
          </div>
          <div
            className="pointer-events-none absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 scale-0 rounded-full bg-white shadow-md transition-transform group-hover/bar:scale-100"
            style={{ left: `${pct}%`, transform: scrubbing ? "translate(-50%, -50%) scale(1)" : undefined }}
          />
          {hover && (
            <span
              className="pointer-events-none absolute bottom-5 -translate-x-1/2 rounded-md bg-black/80 px-1.5 py-0.5 font-mono text-[11px] text-white backdrop-blur"
              style={{ left: Math.min(Math.max(hover.x, 20), (bar.current?.clientWidth ?? 0) - 20) }}
            >
              {fmt(hover.t)}
            </span>
          )}
        </div>

        <div className="mt-1 flex items-center gap-1 text-white">
          <CtrlButton label={playing ? "Pause (k)" : "Play (k)"} onClick={toggle}>
            {playing ? <Pause className="size-4.5 fill-current" /> : <Play className="size-4.5 translate-x-px fill-current" />}
          </CtrlButton>

          <div className="group/vol flex items-center">
            <CtrlButton label={muted ? "Unmute (m)" : "Mute (m)"} onClick={() => setMuted((m) => !m)}>
              <VolIcon className="size-4.5" />
            </CtrlButton>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={muted ? 0 : volume}
              onChange={(e) => {
                setVolume(Number(e.target.value));
                setMuted(false);
              }}
              aria-label="Volume"
              className="h-1 w-0 cursor-pointer appearance-none rounded-full bg-white/30 opacity-0 transition-all duration-200 group-hover/vol:ml-1 group-hover/vol:w-20 group-hover/vol:opacity-100 focus:ml-1 focus:w-20 focus:opacity-100 [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
              style={{ background: `linear-gradient(to right, white ${(muted ? 0 : volume) * 100}%, rgb(255 255 255 / 0.3) 0)` }}
            />
          </div>

          <span className="ml-2 font-mono text-xs text-white/85 tabular-nums">
            {fmt(time)} <span className="text-white/45">/ {fmt(dur)}</span>
          </span>

          <div className="ml-auto flex items-center gap-1">
            {cleanSrc && (
              <CtrlButton label={subs ? "Subtitles on (c)" : "Subtitles off (c)"} onClick={swapSubs} active={subs}>
                <Captions className="size-4.5" />
              </CtrlButton>
            )}
            <button
              type="button"
              onClick={() => setSpeed((s) => SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length])}
              title="Playback speed"
              className="h-8 min-w-11 rounded-full px-2 font-mono text-xs text-white/90 transition-colors hover:bg-white/15"
            >
              {speed}×
            </button>
            {"pictureInPictureEnabled" in document && (
              <CtrlButton label="Picture in picture" onClick={() => void video.current?.requestPictureInPicture?.().catch(() => {})}>
                <PictureInPicture2 className="size-4.5" />
              </CtrlButton>
            )}
            <CtrlButton label={full ? "Exit full screen (f)" : "Full screen (f)"} onClick={fullscreen}>
              {full ? <Minimize className="size-4.5" /> : <Maximize className="size-4.5" />}
            </CtrlButton>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function CtrlButton({ label, onClick, children, active }: { label: string; onClick: () => void; children: React.ReactNode; active?: boolean }) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      whileTap={{ scale: 0.88 }}
      transition={SPRING_PRESS}
      className={cn(
        "relative flex size-8 items-center justify-center rounded-full transition-colors hover:bg-white/15",
        active === true && "text-white after:absolute after:bottom-1 after:h-0.5 after:w-3 after:rounded-full after:bg-primary",
        active === false && "text-white/60",
      )}
    >
      {children}
    </motion.button>
  );
}
