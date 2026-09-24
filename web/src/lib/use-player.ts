import { useCallback, useEffect, useRef, useState } from "react";

export function usePlayer() {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const wanted = useRef<string | null>(null);

  useEffect(() => {
    const a = new Audio();
    a.preload = "none";
    audio.current = a;
    const onTime = () => setProgress(a.duration ? a.currentTime / a.duration : 0);
    const onEnd = () => {
      setPlaying(null);
      setProgress(0);
    };
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("ended", onEnd);
    a.addEventListener("error", onEnd);
    return () => {
      a.pause();
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("ended", onEnd);
      a.removeEventListener("error", onEnd);
    };
  }, []);

  const stop = useCallback(() => {
    wanted.current = null;
    audio.current?.pause();
    setPlaying(null);
    setProgress(0);
  }, []);

  const toggle = useCallback(
    async (key: string, src: string | Promise<string>) => {
      const a = audio.current;
      if (!a) return;
      if (playing === key) {
        stop();
        return;
      }
      a.pause();
      wanted.current = key;
      setPlaying(key);
      setProgress(0);
      try {
        const url = await src;
        if (wanted.current !== key) return;
        a.src = url;
        await a.play();
      } catch {
        setPlaying((p) => (p === key ? null : p));
      }
    },
    [playing, stop],
  );

  return { playing, progress, toggle, stop };
}
