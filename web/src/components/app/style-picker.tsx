import { AnimatePresence, motion } from "motion/react";
import { Check, ImagePlus, Loader2, RefreshCw } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/motion/tabs";
import { TiltCard } from "@/components/motion/tilt-card";
import { SPRING_LAYOUT } from "@/lib/ease";
import type { Style } from "@/lib/api";

export type CustomStyle = { preview: string; url: string; uploading: boolean };

type Props = {
  styles: Style[];
  categories: string[];
  value: string;
  onChange: (id: string) => void;
  custom: CustomStyle | null;
  onCustomFile: (file: File) => void;
};

function Selected() {
  return (
    <motion.span
      layoutId="style-selected"
      transition={SPRING_LAYOUT}
      className="pointer-events-none absolute inset-0 z-10 rounded-xl ring-2 ring-primary ring-offset-2 ring-offset-background"
    >
      <span className="absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg">
        <Check className="size-3" strokeWidth={3} />
      </span>
    </motion.span>
  );
}

function Caption({ children, blurb }: { children: React.ReactNode; blurb?: string }) {
  return (
    <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-2.5 pt-7 pb-1.5">
      <span className="flex items-end justify-between gap-1">
        <span className="truncate text-[12px] font-medium text-white">{children}</span>
      </span>
      {blurb && (
        <span className="grid grid-rows-[0fr] transition-[grid-template-rows] duration-300 group-hover/card:grid-rows-[1fr]">
          <span className="overflow-hidden text-[10.5px] leading-snug text-white/80">{blurb}</span>
        </span>
      )}
    </span>
  );
}

export function StylePicker({ styles, categories, value, onChange, custom, onCustomFile }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [cat, setCat] = useState("All");
  const shown = useMemo(() => (cat === "All" ? styles : styles.filter((s) => s.category === cat)), [styles, cat]);
  const count = (c: string) => styles.filter((s) => s.category === c).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="-mx-1 overflow-x-auto px-1">
        <Tabs value={cat} onValueChange={setCat} variant="segment">
          <TabsList>
            <TabsTrigger value="All">All {styles.length}</TabsTrigger>
            {categories.map((c) => (
              <TabsTrigger key={c} value={c}>
                {c} <span className="ml-1 opacity-50">{count(c)}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-6">
        {shown.map((s) => (
          <button key={s.id} type="button" onClick={() => onChange(s.id)} aria-pressed={value === s.id} title={s.blurb} className="group/card relative text-left">
            <TiltCard max={6} className="rounded-xl border border-border bg-card">
              <img src={s.thumb} alt="" loading="lazy" className="aspect-video w-full object-cover" />
              <Caption blurb={s.blurb}>
                {s.label}
              </Caption>
            </TiltCard>
            {value === s.id && <Selected />}
          </button>
        ))}

        <button
          type="button"
          aria-pressed={value === "custom"}
          onClick={() => (custom?.url && value !== "custom" ? onChange("custom") : fileRef.current?.click())}
          className="relative text-left"
        >
          <TiltCard max={6} className="rounded-xl border border-dashed border-border-strong bg-card">
            <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden">
              <AnimatePresence mode="popLayout" initial={false}>
                {custom ? (
                  <motion.img
                    key={custom.preview}
                    src={custom.preview}
                    alt=""
                    initial={{ opacity: 0, filter: "blur(8px)" }}
                    animate={{ opacity: 1, filter: "blur(0px)" }}
                    className="absolute inset-0 size-full object-cover"
                  />
                ) : (
                  <motion.span key="empty" className="flex flex-col items-center gap-1 pb-4 text-muted-foreground">
                    <ImagePlus className="size-5" />
                    <span className="text-[11px]">Upload an illustration</span>
                  </motion.span>
                )}
              </AnimatePresence>
              {custom?.uploading && (
                <span className="absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-sm">
                  <Loader2 className="size-5 animate-spin" />
                </span>
              )}
              {custom ? (
                <Caption>Your own style</Caption>
              ) : (
                <span className="absolute inset-x-0 bottom-1.5 text-center text-[12px] font-medium">Your own style</span>
              )}
              {custom && (
                <span
                  role="button"
                  tabIndex={0}
                  aria-label="Replace illustration"
                  onClick={(e) => {
                    e.stopPropagation();
                    fileRef.current?.click();
                  }}
                  className="absolute top-1.5 left-1.5 z-20 flex size-6 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur hover:bg-black/70"
                >
                  <RefreshCw className="size-3" />
                </span>
              )}
            </div>
          </TiltCard>
          {value === "custom" && <Selected />}
        </button>

        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onCustomFile(f);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}
