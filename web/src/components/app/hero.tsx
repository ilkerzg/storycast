import { useMemo } from "react";
import { motion } from "motion/react";
import { ArrowRight, Clapperboard, Sparkles } from "lucide-react";
import { Button } from "@/components/motion/button/base";
import { Link, navigate } from "@/lib/router";
import { Marquee } from "@/components/motion/marquee";
import { TextReveal } from "@/components/motion/text-reveal";
import { AgentPromptButton } from "@/components/app/agent-button";
import { EASE_OUT } from "@/lib/ease";
import type { CastMember, Film } from "@/lib/api";

const ROWS = 5;
const PER_ROW = 18;

function PosterWall({ films }: { films: Film[] }) {
  const rows = useMemo(() => {
    const withArt = films.filter((f) => f.thumb || f.poster).slice(0, ROWS * PER_ROW);
    const out: Film[][] = Array.from({ length: ROWS }, () => []);
    withArt.forEach((f, i) => out[i % ROWS].push(f));
    return out.filter((r) => r.length > 0);
  }, [films]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: rows.length ? 1 : 0 }}
      transition={{ duration: 1.2, ease: EASE_OUT }}
      aria-hidden
      className="absolute top-1/2 left-1/2 flex w-[170%] -translate-x-1/2 -translate-y-1/2 -rotate-6 flex-col gap-3 sm:w-[150%] sm:gap-4"
    >
      {rows.map((row, r) => (
        <Marquee key={r} direction={r % 2 ? "right" : "left"} speed={110 + r * 14} gap="0.75rem" fade={false} pauseOnHover>
          {row.map((f) => (
            <Link
              key={f.id}
              to={`/films/${encodeURIComponent(f.id)}`}
              tabIndex={-1}
              aria-label={f.title}
              className="group/poster relative block aspect-video w-44 overflow-hidden rounded-xl border border-border bg-card shadow-lg shadow-black/20 sm:w-64 lg:w-72"
            >
              <img
                src={f.thumb || f.poster!}
                alt=""
                loading="lazy"
                draggable={false}
                className="size-full object-cover transition-transform duration-500 group-hover/poster:scale-[1.06]"
              />
              <span className="absolute inset-x-0 bottom-0 translate-y-1 bg-gradient-to-t from-black/80 to-transparent px-3 pt-6 pb-2 text-left text-xs font-medium text-white opacity-0 transition-all duration-300 group-hover/poster:translate-y-0 group-hover/poster:opacity-100 sm:text-sm">
                {f.title}
              </span>
            </Link>
          ))}
        </Marquee>
      ))}
    </motion.div>
  );
}

export function Hero({ cast, films }: { cast: CastMember[]; films: Film[] }) {
  return (
    <>
      <section className="relative mx-[calc(50%-50vw)] flex min-h-[560px] items-center justify-center overflow-hidden sm:min-h-[680px]">
        <PosterWall films={films} />
        <div className="pointer-events-none absolute inset-0 bg-background/55" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-background to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-background to-transparent" />

        <div className="pointer-events-none relative z-10 px-4 py-16 text-center">
          <div className="absolute -inset-x-10 inset-y-6 -z-10 rounded-[50%] bg-background/90 blur-2xl sm:-inset-x-24" />
          <motion.div
            initial={{ opacity: 0, y: 8, filter: "blur(6px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 0.6, ease: EASE_OUT }}
            className="gradient-ring mx-auto inline-flex items-center gap-2 rounded-full bg-card/80 px-4 py-2 text-sm backdrop-blur"
          >
            <Sparkles className="size-4 text-accent" />
            <span className="font-medium">{cast.length} narrators ready to tell your story</span>
            <span className="hidden text-muted-foreground sm:inline">· or invent your own</span>
          </motion.div>

          <h1 className="mx-auto mt-6 max-w-3xl text-balance text-5xl font-medium tracking-tight md:text-6xl">
            <TextReveal text="Type a topic." className="block" />
            <TextReveal text="Get a story." className="block text-muted-foreground" delay={0.25} />
          </h1>

          <motion.p
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.45, ease: EASE_OUT }}
            className="mx-auto mt-5 max-w-xl text-pretty text-base text-muted-foreground"
          >
            Pick a character and give it a topic. It tells the story in its own voice, scene by scene, and you get back a finished animated story to watch and share.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.55, ease: EASE_OUT }}
            className="pointer-events-auto mt-8 flex flex-wrap items-center justify-center gap-3"
          >
            <Button size="lg" onClick={() => navigate("/create")}>
              <Clapperboard className="size-4" /> Start a story
            </Button>
            <Link to="/films" className="inline-flex h-12 items-center gap-2 rounded-full border border-border bg-background/70 px-6 text-sm backdrop-blur transition-colors hover:border-border-strong">
              Browse stories <ArrowRight className="size-4" />
            </Link>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.65, ease: EASE_OUT }}
            className="pointer-events-auto mt-5 flex justify-center"
          >
            <AgentPromptButton />
          </motion.div>
        </div>
      </section>

      {cast.length > 0 && (
        <Marquee speed={150} gap="1rem" fade pauseOnHover>
          {cast.map((c) => (
            <Link key={c.id} to={`/create?character=${c.id}`} className="group/cast block w-40 shrink-0 overflow-hidden rounded-2xl border border-border bg-card text-left transition-colors hover:border-border-strong">
              <img src={c.thumb} alt={c.name} loading="lazy" className="aspect-[3/4] w-full object-cover transition-transform duration-500 group-hover/cast:scale-[1.04]" />
              <span className="block px-3 pt-2 text-sm font-medium">{c.name}</span>
              <span className="block truncate px-3 pb-2.5 text-[11px] text-muted-foreground">{c.personality}</span>
            </Link>
          ))}
        </Marquee>
      )}
    </>
  );
}
