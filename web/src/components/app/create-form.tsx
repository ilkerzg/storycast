import { AnimatePresence, motion } from "motion/react";
import { Clapperboard, Clock, Coins, ImagePlus, Lightbulb, Loader2, UserRound, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { setAgentContext } from "@/lib/agent";
import { StatefulButton, type ButtonState } from "@/components/motion/button/stateful";
import { Input } from "@/components/motion/input";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxSeparator,
  ComboboxTrigger,
} from "@/components/motion/combobox";
import { NumberTicker } from "@/components/motion/number-ticker";
import { RangeSlider } from "@/components/motion/range-slider";
import { CharacterPicker, type CharacterChoice } from "@/components/app/character-picker";
import { StylePicker, type CustomStyle } from "@/components/app/style-picker";
import { VoiceField } from "@/components/app/voice-field";
import { EASE_OUT } from "@/lib/ease";
import { cn } from "@/lib/utils";
import { api, type Config, type NewJob, type Voice } from "@/lib/api";
import { dollars, estimateCost } from "@/lib/studio/cost";
import { Tabs, TabsList, TabsTrigger } from "@/components/motion/tabs";
import type { Resolution } from "@/lib/studio/pipeline";

const POPULAR = ["en", "tr", "es", "fr", "de", "pt", "ar", "hi", "zh", "ja", "ko", "ru"];
const IDEAS = ["Why is the sky blue?", "How do bees make honey?", "The first photograph", "How do volcanoes work?"];

function Label({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3">
      <span className="text-xs font-medium text-muted-foreground">{children}</span>
      {aside}
    </div>
  );
}

type Character = { preview: string; url: string; uploading: boolean; error?: string };

function NarratorSlot({ value, name, onName, onFile, onClear }: { value: Character | null; name: string; onName: (v: string) => void; onFile: (f: File) => void; onClear: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files?.[0];
        if (f && f.type.startsWith("image/")) onFile(f);
      }}
      className={cn(
        "flex items-center gap-3 rounded-2xl border border-dashed p-2 pr-2.5 transition-colors",
        drag ? "border-primary bg-primary/5" : "border-border-strong bg-background/30",
      )}
    >
      <button type="button" onClick={() => fileRef.current?.click()} className="relative size-10 shrink-0 overflow-hidden rounded-xl bg-muted" aria-label="Upload a character">
        <AnimatePresence mode="popLayout" initial={false}>
          {value ? (
            <motion.img key={value.preview} src={value.preview} alt="" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="size-full object-cover" />
          ) : (
            <motion.span key="empty" className="flex size-full items-center justify-center text-muted-foreground">
              <ImagePlus className="size-4" />
            </motion.span>
          )}
        </AnimatePresence>
        {value?.uploading && (
          <span className="absolute inset-0 flex items-center justify-center bg-background/60">
            <Loader2 className="size-4 animate-spin" />
          </span>
        )}
      </button>
      {value && !value.uploading && !value.error ? (
        <input
          value={name}
          onChange={(e) => onName(e.target.value)}
          placeholder="Name your character (optional)"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      ) : (
        <button type="button" onClick={() => fileRef.current?.click()} className="min-w-0 flex-1 text-left">
          <p className={cn("truncate text-sm", value?.error ? "text-destructive" : "font-medium")}>{value?.error ?? (value?.uploading ? "Uploading…" : "Your own character")}</p>
          <p className="truncate text-xs text-muted-foreground">Optional · drop an image, or one is invented</p>
        </button>
      )}
      {value ? (
        <button type="button" onClick={onClear} aria-label="Remove character" className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground">
          <X className="size-4" />
        </button>
      ) : (
        <UserRound className="mr-1.5 size-4 shrink-0 text-muted-foreground" />
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

type Props = {
  config: Config;
  busy: boolean;
  onStart: (body: NewJob) => Promise<void>;
  onError: (message: string) => void;
};

export function CreateForm({ config, busy, onStart, onError }: Props) {
  const [topic, setTopic] = useState("");
  const [topicError, setTopicError] = useState<string | false>(false);
  const [style, setStyle] = useState(() => {
    const wanted = new URLSearchParams(window.location.search).get("style");
    return config.styles.some((s) => s.id === wanted) ? (wanted as string) : (config.styles[0]?.id ?? "stick-figure");
  });
  const [custom, setCustom] = useState<CustomStyle | null>(null);
  const [minutes, setMinutes] = useState(1);
  const [resolution, setResolution] = useState<Resolution>("768P");
  const [language, setLanguage] = useState("en");
  const [character, setCharacter] = useState<Character | null>(null);
  const [charName, setCharName] = useState("");
  const [voice, setVoice] = useState<Voice | null>(null);
  const [choice, setChoice] = useState<CharacterChoice>(() => {
    const wanted = new URLSearchParams(window.location.search).get("character");
    const hit = config.characters.find((c) => c.id === wanted) ?? config.characters[0];
    return hit ? { kind: "cast", id: hit.id } : { kind: "new" };
  });
  const member = choice.kind === "cast" ? config.characters.find((c) => c.id === choice.id) : undefined;
  const [submit, setSubmit] = useState<ButtonState>("idle");
  const [confirm, setConfirm] = useState(false);
  const changeMinutes = (m: number) => {
    setMinutes(m);
    setConfirm(false);
  };
  const eta = Math.round(4 + 1.5 * minutes);

  useEffect(() => {
    setAgentContext({
      kind: "create",
      topic: topic.trim(),
      style,
      styleUrl: custom?.url ?? "",
      minutes,
      language,
      characterId: member?.id ?? "",
      characterUrl: choice.kind === "upload" ? (character?.url ?? "") : "",
      characterName: choice.kind === "upload" ? charName.trim() : "",
      voice: voice ? { voice_id: voice.voice_id, name: voice.name } : null,
      resolution,
    });
  }, [topic, style, custom, minutes, language, member, choice, character, charName, voice, resolution]);
  useEffect(() => () => setAgentContext(null), []);

  async function uploadStyle(file: File) {
    const preview = URL.createObjectURL(file);
    setCustom({ preview, url: "", uploading: true });
    setStyle("custom");
    try {
      const url = await api.upload(file);
      setCustom({ preview, url, uploading: false });
    } catch (e) {
      setCustom(null);
      setStyle(config.styles[0]?.id ?? "stick-figure");
      onError((e as Error).message);
    }
  }

  async function uploadCharacter(file: File) {
    const preview = URL.createObjectURL(file);
    setCharacter({ preview, url: "", uploading: true });
    try {
      const url = await api.upload(file);
      setCharacter({ preview, url, uploading: false });
    } catch (e) {
      setCharacter({ preview, url: "", uploading: false, error: (e as Error).message });
    }
  }

  async function go(confirmed = false) {
    if (!topic.trim()) {
      setTopicError("Give the film a topic first");
      return;
    }
    if (!member && ((style === "custom" && !custom?.url) || character?.uploading)) {
      onError("An image is still uploading");
      return;
    }
    if (choice.kind === "upload" && !character?.url) {
      onError("Upload your character first");
      return;
    }
    if (minutes >= 2 && !confirmed) {
      setConfirm(true);
      return;
    }
    setConfirm(false);
    setSubmit("loading");
    try {
      await onStart({
        topic: topic.trim(),
        style: member ? member.style : style,
        minutes,
        language,
        style_url: !member && style === "custom" ? (custom?.url ?? "") : "",
        character_url: choice.kind === "upload" ? (character?.url ?? "") : "",
        character_name: choice.kind === "upload" ? charName.trim() : "",
        character_id: member?.id ?? "",
        voice,
        resolution,
      });
      setSubmit("success");
      setTimeout(() => setSubmit("idle"), 1600);
    } catch (e) {
      setSubmit("error");
      onError((e as Error).message);
      setTimeout(() => setSubmit("idle"), 2000);
    }
  }

  const chosen = config.styles.find((s) => s.id === style);
  const styleLabel = style === "custom" ? "Your own style" : chosen?.label;
  const who = member ? member.name : choice.kind === "upload" ? charName.trim() || "Your character" : "A new character";

  return (
    <motion.section
      id="create"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: EASE_OUT }}
      className="grid gap-6 rounded-3xl border border-border bg-card/40 p-4 sm:p-6 lg:grid-cols-[minmax(340px,420px)_minmax(0,1fr)] lg:gap-8"
    >
      <div className="flex min-w-0 flex-col gap-5">
        <div>
          <Label>Topic</Label>
          <Input
            value={topic}
            onChange={(v) => {
              setTopic(v);
              if (topicError) setTopicError(false);
            }}
            onKeyDown={(e) => e.key === "Enter" && go()}
            placeholder="How do bees make honey?"
            leftIcon={<Lightbulb className="size-4" />}
            error={topicError}
            classNames={{ field: "h-12" }}
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {IDEAS.map((idea) => (
              <button
                key={idea}
                type="button"
                onClick={() => {
                  setTopic(idea);
                  setTopicError(false);
                }}
                className="rounded-full border border-border px-2.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
              >
                {idea}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <Label aside={<span className="font-mono text-xs"><NumberTicker value={minutes} /> min</span>}>Length</Label>
            <RangeSlider min={1} max={config.max_minutes} step={1} value={minutes} onValueChange={changeMinutes} aria-label="Length in minutes" formatValueText={(v) => `${v} minutes`} />
            <div className="mt-1 flex justify-between px-[7px] font-mono text-[10px] text-muted-foreground">
              {Array.from({ length: config.max_minutes }, (_, i) => (
                <button key={i} type="button" onClick={() => changeMinutes(i + 1)} className={cn("w-3 text-center transition-colors hover:text-foreground", minutes === i + 1 && "text-foreground")}>
                  {i + 1}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label aside={<span className="text-[11px] text-muted-foreground">{config.languages.length} languages</span>}>Language</Label>
            <Combobox value={language} onValueChange={(v) => v && setLanguage(v)}>
              <ComboboxTrigger className="h-10 rounded-xl px-2.5">
                <ComboboxInput aria-label="Search languages" placeholder="Search languages…" />
              </ComboboxTrigger>
              <ComboboxContent className="w-72 rounded-2xl">
                <ComboboxList ariaLabel="Languages" className="max-h-72 p-1.5">
                  <ComboboxEmpty>No language found.</ComboboxEmpty>
                  {(["Popular", "All languages"] as const).map((group, gi) => (
                    <ComboboxGroup key={group}>
                      {gi > 0 ? <ComboboxSeparator /> : null}
                      <ComboboxLabel>{group}</ComboboxLabel>
                      {config.languages
                        .filter((l) => (group === "Popular" ? POPULAR.includes(l.code) : !POPULAR.includes(l.code)))
                        .sort((x, y) => (group === "Popular" ? POPULAR.indexOf(x.code) - POPULAR.indexOf(y.code) : x.name.localeCompare(y.name)))
                        .map((l) => (
                          <ComboboxItem key={l.code} value={l.code} textValue={l.name} keywords={[l.native, l.code]}>
                            <span className="flex min-w-0 items-baseline justify-between gap-3">
                              <span className="truncate">{l.name}</span>
                              <span className="shrink-0 text-xs text-muted-foreground">{l.native}</span>
                            </span>
                          </ComboboxItem>
                        ))}
                    </ComboboxGroup>
                  ))}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
          </div>
        </div>

        <div>
          <Label aside={<span className="text-[11px] text-muted-foreground">{resolution === "480P" ? "Softer picture, lower price" : "Sharper picture"}</span>}>Quality</Label>
          <Tabs value={resolution} onValueChange={(v) => setResolution(v as Resolution)} variant="segment">
            <TabsList>
              <TabsTrigger value="768P">768p</TabsTrigger>
              <TabsTrigger value="480P">480p</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <div>
          <Label>Voice</Label>
          <VoiceField
            value={voice}
            onChange={setVoice}
            lang={language}
            topic={topic}
            fallback={member ? { title: `${member.name}'s voice`, detail: member.voice.name ? `${member.voice.name} · pick another any time` : "Pick another any time" } : undefined}
          />
        </div>

        <div className="mt-auto flex flex-col gap-2 border-t border-border pt-5">
          <AnimatePresence initial={false} mode="popLayout">
            {confirm && minutes >= 2 ? (
              <motion.div
                key="confirm"
                role="alertdialog"
                aria-label="Before you start"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                transition={{ duration: 0.2, ease: EASE_OUT }}
                className="rounded-2xl border border-border bg-muted/40 p-4"
              >
                <p className="text-sm font-medium">Before you start</p>
                <ul className="mt-2.5 flex flex-col gap-2 text-xs text-muted-foreground">
                  <li className="flex gap-2">
                    <Clock className="mt-px size-3.5 shrink-0" />
                    <span>
                      A {minutes}-minute film takes about {eta} minutes. Keep this tab open until it's done, or production stops halfway.
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <Coins className="mt-px size-3.5 shrink-0" />
                    <span>
                      It costs about <span className="font-medium text-foreground tabular-nums">{dollars(estimateCost(minutes, !member, resolution).total)}</span> on your fal key.
                    </span>
                  </li>
                </ul>
                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirm(false)}
                    className="h-10 flex-1 rounded-full border border-border text-sm transition-colors hover:border-border-strong"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={() => go(true)}
                    className="inline-flex h-10 flex-[2] items-center justify-center gap-2 rounded-full bg-primary text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
                  >
                    <Clapperboard className="size-4" /> Start the film
                  </button>
                </div>
              </motion.div>
            ) : (
              <motion.div key="start" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                <StatefulButton size="lg" state={submit} onClick={() => go()} loadingText="Starting" successText="Rolling" icon={<Clapperboard className="size-4" />} className="w-full">
                  Make the film
                </StatefulButton>
              </motion.div>
            )}
          </AnimatePresence>
          <p className="text-center text-[11px] text-muted-foreground">
            {busy ? "A film is in production; new ones wait in line." : `${who} · ${member ? member.style_label : styleLabel} · ${minutes} min · ready in about ${eta} min`}
          </p>
          {(() => {
            const c = estimateCost(minutes, !member, resolution);
            return (
              <p className="text-center text-[11px] text-muted-foreground">
                About{" "}
                <span
                  className="cursor-help tabular-nums underline decoration-dotted underline-offset-2"
                  title={`Video ${dollars(c.video)} · images ${dollars(c.images)} · voice & music ${dollars(c.sound)} · direction & checks ${dollars(c.direction)}`}
                >
                  {dollars(c.total)}
                </span>{" "}
                on your fal key
              </p>
            );
          })()}
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-5">
        <div>
          <Label aside={<span className="truncate text-[11px] text-muted-foreground">{member ? `${member.name}: ${member.personality}` : `${config.characters.length} narrators, each with their own look and voice`}</span>}>
            Character
          </Label>
          <CharacterPicker cast={config.characters} groups={config.character_groups} lang={language} value={choice} onChange={setChoice} uploadPreview={character?.preview} />
        </div>

        <AnimatePresence initial={false}>
          {choice.kind === "upload" && (
            <motion.div key="upload" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.3, ease: EASE_OUT }} className="overflow-hidden">
              <Label>Your character</Label>
              <NarratorSlot
                value={character}
                name={charName}
                onName={setCharName}
                onFile={uploadCharacter}
                onClear={() => {
                  setCharacter(null);
                  setCharName("");
                }}
              />
            </motion.div>
          )}
          {choice.kind !== "cast" && (
            <motion.div key="look" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.3, ease: EASE_OUT }} className="overflow-hidden">
              <Label aside={<span className="truncate text-[11px] text-muted-foreground">{style === "custom" ? "Your uploaded illustration sets the look" : `${chosen?.label}: ${chosen?.blurb}`}</span>}>
                {choice.kind === "upload" ? "Redraw it in" : "Look"}
              </Label>
              <StylePicker styles={config.styles} categories={config.categories} value={style} onChange={setStyle} custom={custom} onCustomFile={uploadStyle} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.section>
  );
}
