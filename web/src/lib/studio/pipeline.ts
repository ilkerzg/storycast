import type { JobEvent, Plan as EventPlan } from "@/lib/api";
import { studioData, type CastFull, type StyleFull } from "./data";
import * as director from "./director";
import type { Block, Given, GivenVoice, Plan } from "./director";
import { FalError, duration, isKeyError, run } from "./fal";
import { saveRecord, type FilmRecord } from "./store";
import { checkVoice } from "./voices";

export const T2I = "openai/gpt-image-2.5/flare/text-to-image";
export const EDIT = "openai/gpt-image-2.5/flare/edit";
export const R2V = "minimax/h3-max/reference-to-video";
export const LIPSYNC = "minimax/h3-max/lip-sync/image-to-video";
export const TTS = "fal-ai/elevenlabs/tts/eleven-v3";
export const MUSIC = "elevenlabs/music/v2.5";
export const TRIM = "fal-ai/workflow-utilities/trim-video";
export const MERGE = "fal-ai/ffmpeg-api/merge-videos";
export const STILL = "fal-ai/ffmpeg-api/images-to-video";
export const COMPOSE = "fal-ai/ffmpeg-api/compose";
export const LOUDNORM = "fal-ai/ffmpeg-api/loudnorm";
export const MERGE_AV = "fal-ai/ffmpeg-api/merge-audio-video";
export const SUBTITLE = "fal-ai/workflow-utilities/auto-subtitle";
export const SEPARATE = "fal-ai/sam-audio/separate";
export const FRAME_AT = "fal-ai/ffmpeg-api/extract-frame";
export const VISION = "openrouter/router/vision";
export const CHECKER = "google/gemini-3.8-flash";

export const RES = "768P";
export const FRAME = { width: 1344, height: 768 };
export const STYLE_REF_NOTE = "shows only the target art style: match its medium, linework, texture, lighting and palette; do not copy its content";
export const WIDE = { width: 1920, height: 1088 };
export const PORTRAIT = { width: 1088, height: 1440 };
export const [LEAD, GAP, TAIL_DUR, END_CARD, FPS] = [1.5, 0.35, 8.0, 4.0, 24];
export const [MUSIC_LUFS, FINAL_LUFS] = [-30, -16];
export const PULL_BACK =
  " The character stays small in the lower half of the frame; the camera never moves closer, it slowly pulls back, keeping the upper half of the frame calm open space.";

export const CHARACTER_REF_NOTE = "Image 1 is the character: keep its design, proportions, colors and props exactly.";
export const SPEECH_PROMPT = "people talking, human speech and voices";
export const SHEET_CHECK_SYSTEM = "You are a strict film quality checker. Answer with JSON only.";
export const SHEET_CHECK_PROMPT =
  "Image 1 is a character model sheet (the same character drawn several times). The other images are frames from a " +
  "film shot. Does any of them show a model sheet or turnaround layout instead of a real scene: the character " +
  'repeated side by side, a plain studio background, or a pose lineup like Image 1? Return {"sheet": true|false}.';

type Who = { name: string; traits: string; pronoun: string };
const charLine = (c: Who) => `${c.name.toUpperCase()}, ${c.traits}`;

export function keyframePrompt(c: Who, anchor: string, styleRef: boolean, scene: string, withChar: boolean, talking: boolean) {
  const pron = c.pronoun || "its";
  if (!withChar) {
    const ref = styleRef ? `Image 1 ${STYLE_REF_NOTE}. ` : "";
    return `${ref}New film still, no characters in this frame. ${scene} No readable text anywhere. ${anchor}`;
  }
  const talk = talking ? ` ${c.name} faces the camera in a medium close-up, talking warmly with ${pron} mouth open.` : "";
  const ref = styleRef ? ` Image 3 ${STYLE_REF_NOTE}.` : "";
  return `Image 1 and Image 2 show ${charLine(c)}. Keep ${pron} design exactly.${ref} New film still: ${scene}${talk} No readable text anywhere. ${anchor}`;
}

export function shotPrompt(c: Who, motion: string, b: { scene: string; action: string; camera?: string; sound?: string }, withChar: boolean) {
  const body = `${b.action} ${b.camera ?? ""}.`.replaceAll("..", ".");
  const tail = `${motion} Sound: ${b.sound ?? "soft ambience"}. No dialogue, no speech, no music. No readable text.`;
  if (withChar)
    return (
      `Image 1 is the opening frame of this shot: ${b.scene} ${body} ` +
      `Image 2 is a reference portrait of ${charLine(c)}, only for keeping ${c.name}'s look consistent: never show Image 2 ` +
      `itself, never a character sheet, a lineup or several copies of ${c.name}. Nobody speaks: ${c.name}'s mouth stays closed. ${tail}`
    );
  return `Image 1 is the opening frame of this shot: ${b.scene} ${body} ${tail}`;
}

export function endCardPrompt(title: string, subtitle: string, anchor: string) {
  return (
    `Keep this illustration exactly as it is and add the film title hand-lettered in the calm open space of the upper third: ` +
    `"${title}" large, and below it, smaller, "${subtitle}". Lettering drawn in the same medium and palette as the ` +
    `illustration, perfectly spelled, centred, nothing else added. ${anchor}`
  );
}

export const shotDuration = (need: number) => Math.max(5, Math.min(15, Math.ceil(need) + 1));

export function subtitleInput(lang: string, font: string, accent: string) {
  return {
    language: lang,
    font_name: font,
    font_weight: "bold",
    font_color: "white",
    highlight_color: namedColor(accent),
    stroke_color: "black",
    stroke_width: 3,
    font_size: 54,
    words_per_subtitle: 4,
    position: "bottom",
    y_offset: 40,
    enable_animation: true,
  };
}

export type JobInput = {
  topic: string;
  style: string;
  minutes: number;
  lang: string;
  style_url: string;
  character_url: string;
  character_name: string;
  character_id: string;
  voice: GivenVoice | Record<string, never>;
};
type Spec = {
  shot: string;
  bi: number;
  scene: string;
  talking: boolean;
  with_char: boolean;
  key_url?: string;
  clip_url?: string;
  clip_dur?: number;
  raw_url?: string;
  reshot?: boolean;
  checked?: boolean;
};

type State = {
  style?: StyleFull;
  plan?: Plan;
  specs?: Spec[];
  sheet_url?: string;
  hero_url?: string;
  music_url?: string;
  card_image?: string;
  card_clip?: string;
};

const now = () => Date.now() / 1000;
const ms = (s: number) => Math.round(s * 1000);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function characterPrompts(line: string, anchor: string): [string, string] {
  const sheet =
    `Character model sheet for an animated film. The character is ${line}. The sheet shows full-body front view, ` +
    `three-quarter view, side profile, back view, and three head close-ups (curious, happy, talking with mouth open). Plain soft ` +
    `light-grey backdrop, even soft studio lighting, clean spacing, consistent design across all views, no text labels. Style: ${anchor}`;
  const hero =
    `Hero portrait of ${line}. Standing full body, three-quarter view, looking at the viewer with a warm smile, one hand raised in a wave. ` +
    `Plain soft backdrop, soft studio light. Style: ${anchor}`;
  return [sheet, hero];
}

export function newRecord(input: JobInput): FilmRecord {
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  return {
    ...input,
    id,
    status: "queued",
    stage: "queued",
    result: {},
    error: "",
    created: now(),
    project: "",
    events: [],
    style_label: input.style,
    title: "",
    subtitle: "",
    narrator: {},
    voice_id: "",
    blocks: [],
    assets: {},
    state: {},
  };
}

export class Film {
  rec: FilmRecord;
  st: State;
  cast: CastFull | null = null;
  style!: StyleFull;
  styleRef = "";
  private onEvent: (e: JobEvent, rec: FilmRecord) => void;
  private saving: Promise<unknown> | null = null;
  private dirty = false;

  constructor(rec: FilmRecord, onEvent: (e: JobEvent, rec: FilmRecord) => void) {
    this.rec = rec;
    this.st = (rec.state ??= {}) as State;
    this.onEvent = onEvent;
  }

  get plan(): Plan {
    return this.st.plan!;
  }
  get specs(): Spec[] {
    return this.st.specs!;
  }
  blockOf(s: Spec): Block | Plan["tail"] {
    return s.bi < 0 ? this.plan.tail : this.plan.blocks[s.bi];
  }

  checkpoint() {
    if (this.saving) {
      this.dirty = true;
      return this.saving;
    }
    this.saving = saveRecord(this.record())
      .catch(() => {})
      .finally(() => {
        this.saving = null;
        if (this.dirty) {
          this.dirty = false;
          this.checkpoint();
        }
      });
    return this.saving;
  }

  log(stage: string, msg: string, extra: Partial<JobEvent> = {}) {
    const e: JobEvent = { t: Math.round((now() - this.rec.created) * 10) / 10, stage, msg, ...extra };
    this.rec.stage = stage;
    this.rec.events.push(e);
    this.onEvent(e, this.rec);
    this.checkpoint();
  }

  eventPlan(): EventPlan {
    const p = this.plan;
    return { title: p.title, subtitle: p.subtitle, character: p.character, blocks: p.blocks.map((b) => ({ kind: b.kind, text: b.text })) };
  }

  charLine() {
    return charLine(this.plan.character);
  }

  keyPrompt(scene: string, withChar: boolean, talking: boolean) {
    return keyframePrompt(this.plan.character, this.style.anchor, !!this.styleRef, scene, withChar, talking);
  }

  motionPrompt(b: { scene: string; action: string; camera?: string; sound?: string }, withChar: boolean) {
    return shotPrompt(this.plan.character, this.style.motion, b, withChar);
  }

  async run() {
    const j = this.rec;
    const data = await studioData();
    this.cast = j.character_id ? (data.characters.find((c) => c.id === j.character_id) ?? null) : null;
    if (this.cast) j.style = this.cast.style;
    const preset = data.styles.find((s) => s.id === j.style);
    this.styleRef = j.style_url || preset?.ref || "";
    if (this.st.style) this.style = this.st.style;
    else if (j.style === "custom") {
      this.log("director", "Opus 5.5 is studying your illustration style…");
      const d = await director.describeStyle(j.style_url);
      this.style = this.st.style = {
        id: "custom",
        label: d.label || "Custom style",
        thumb: "",
        category: "",
        blurb: "",
        ref: "",
        anchor: d.anchor,
        motion: d.motion,
        character_hint: d.character_hint || "an original narrator that belongs to this world",
        palette: d.palette,
      };
      this.log("director", `Style: ${this.style.label}: ${this.style.anchor.slice(0, 160)}…`);
    } else {
      if (!preset) throw new Error(`unknown style ${j.style}`);
      this.style = this.st.style = preset;
    }
    j.style_label = this.style.label;

    if (!this.st.plan) {
      let given: Given | null = null;
      if (this.cast) {
        given = { name: this.cast.name, traits: this.cast.traits, pronoun: this.cast.pronoun, personality: this.cast.personality };

        if (!j.voice?.voice_id) {
          j.voice = { ...this.cast.voice };
          const check = await checkVoice({ id: this.cast.voice.voice_id }, j.lang);
          if (check.voice && !check.speaks) {
            const alt = check.native;
            if (alt) {
              this.log("director", `${this.cast.name}'s voice is not made for this language; ${alt.name.split(" - ")[0]} narrates instead`);
              j.voice = { voice_id: alt.voice_id, name: alt.name, gender: alt.gender, age: alt.age, accent: alt.accent, description: alt.description };
            }
          }
        }
      } else if (j.character_url) {
        this.log("director", "Opus 5.5 is getting to know your character…");
        given = await director.describeCharacter(j.character_url, j.character_name);
        this.log("director", `Narrator: ${given.name}: ${given.traits.slice(0, 160)}…`);
      }
      const voice = j.voice?.voice_id ? (j.voice as GivenVoice) : null;
      if (voice) this.log("director", `Voice: ${voice.name || voice.voice_id}`);
      this.log("director", `Opus 5.5 is writing the film (${j.minutes} min, ${this.style.label})…`);
      const p = await director.plan(j.topic, this.style, j.minutes, j.lang, given, voice);
      j.project = `${p.slug}-${j.id.slice(0, 4)}`;
      p.blocks.forEach((b, i) => {
        const n = String(i + 1).padStart(2, "0");
        b.id = `B${n}`;
        b.shot = (b.kind === "T" ? "T" : "S") + n;
      });
      p.tail.shot = `S${String(p.blocks.length + 1).padStart(2, "0")}`;
      this.st.plan = p;
      if (p.continuity && (p.continuity.rewrites || p.continuity.bridges))
        this.log("director", `Script editor smoothed the flow: ${p.continuity.rewrites} rewritten, ${p.continuity.bridges} bridging scene${p.continuity.bridges === 1 ? "" : "s"} added`);
      this.log("director", `“${p.title} ${p.subtitle}”: ${p.blocks.length} blocks, narrator ${p.character.name}`, {
        plan: this.eventPlan(),
      });
    } else {
      this.log("director", `Resuming “${this.plan.title} ${this.plan.subtitle}”`, {
        plan: this.eventPlan(),
      });
    }

    await Promise.all([this.character(), this.voice()]);
    await this.keyframes();
    const music = this.music();
    const card = this.endCard();
    music.catch(() => {});
    card.catch(() => {});
    await this.shots();
    await Promise.all([music, card]);
    await this.assemble();
  }

  async character() {
    const c = this.plan.character;
    if (this.cast?.sheet && this.cast.hero) {
      this.st.sheet_url = this.cast.sheet;
      this.st.hero_url = this.cast.hero;
    }
    if (this.st.sheet_url && this.st.hero_url) {
      Object.assign(this.rec.assets, { sheet: this.st.sheet_url, hero: this.st.hero_url });
      this.log("character", `${c.name} is ready`, { images: [this.st.sheet_url, this.st.hero_url] });
      return;
    }
    const [sheet, hero] = characterPrompts(this.charLine(), this.style.anchor);
    this.log("character", `Designing ${c.name} (GPT Image 2.5)…`);
    const refs = [this.rec.character_url, this.styleRef].filter(Boolean);
    type Img = { images: { url: string }[] };
    let rs: Img, rh: Img;
    if (refs.length) {
      const lead: string[] = [];
      if (this.rec.character_url) lead.push(CHARACTER_REF_NOTE);
      if (this.styleRef) lead.push(`Image ${refs.length} ${STYLE_REF_NOTE}.`);
      const pre = lead.join(" ") + " ";
      [rs, rh] = await Promise.all([
        run<Img>(EDIT, { image_urls: refs, prompt: pre + sheet, image_size: WIDE, quality: "high" }),
        run<Img>(EDIT, { image_urls: refs, prompt: pre + hero, image_size: PORTRAIT, quality: "high" }),
      ]);
    } else {
      [rs, rh] = await Promise.all([
        run<Img>(T2I, { prompt: sheet, image_size: WIDE, quality: "high" }),
        run<Img>(T2I, { prompt: hero, image_size: PORTRAIT, quality: "high" }),
      ]);
    }
    this.st.sheet_url = rs.images[0].url;
    this.st.hero_url = rh.images[0].url;
    Object.assign(this.rec.assets, { sheet: this.st.sheet_url, hero: this.st.hero_url });
    this.log("character", `${c.name} is ready`, { images: [this.st.sheet_url, this.st.hero_url] });
  }

  async tts(b: Block, force = false) {
    if (b.audio_url && b.audio_dur && !force) return;
    const { curated_voices } = await studioData();
    type Audio = { audio: { url: string } };
    let r: Audio;
    try {
      r = await run<Audio>(TTS, { text: b.text, voice: this.plan.voice_id, stability: 0.5, language_code: this.rec.lang });
    } catch (e) {
      if (!String(e).toLowerCase().includes("not found") || this.plan.voice_id in curated_voices) throw e;

      const fallback = Object.keys(curated_voices)[0];
      this.log("voice", `Voice unavailable on fal, switching to ${curated_voices[fallback].split(":")[0]}`);
      this.plan.voice_id = fallback;
      r = await run<Audio>(TTS, { text: b.text, voice: fallback, stability: 0.5, language_code: this.rec.lang });
    }
    b.audio_url = r.audio.url;
    b.audio_dur = await duration(b.audio_url);
    this.checkpoint();
  }

  async voice() {
    this.log("voice", "Recording the narration (ElevenLabs v3)…");
    await Promise.all(this.plan.blocks.map((b) => this.tts(b)));
    const inRange = (b: Block) => b.audio_dur! >= 5.2 && b.audio_dur! <= 14.6;
    for (const b of this.plan.blocks) {
      let tries = 0;
      while (b.kind === "T" && !inRange(b) && tries < 2) {
        tries++;
        b.text = await director.resizeLine(b.text, b.audio_dur!, this.rec.lang);
        await this.tts(b, true);
      }
      if (b.kind === "T" && !inRange(b)) {
        b.kind = "V";
        b.shot = "S" + b.shot.slice(1);
        if (!b.action) b.action = "The character gestures while the scene breathes with small ambient motion.";
      }
    }
    this.rec.assets.narration = Object.fromEntries(this.plan.blocks.map((b) => [b.id, b.audio_url]));
    const total = sum(this.plan.blocks.map((b) => b.audio_dur!));
    this.log("voice", `Narration ready: ${total.toFixed(0)} s of speech`);
  }

  async oneKey(spec: Spec) {
    if (spec.key_url) return;
    let scene = spec.scene;
    const { with_char: withChar, talking } = spec;
    let r: { images: { url: string }[] } | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (attempt === 2) {
          r = await run(T2I, { prompt: `${scene} No readable text anywhere. ${this.style.anchor}`, image_size: WIDE, quality: "high" }, 0);
          spec.with_char = false;
        } else {
          const urls = withChar
            ? [this.st.sheet_url, this.st.hero_url, ...(this.styleRef ? [this.styleRef] : [])]
            : this.styleRef
              ? [this.styleRef]
              : [this.st.sheet_url];
          r = await run(EDIT, { image_urls: urls, prompt: this.keyPrompt(scene, withChar, talking), image_size: WIDE, quality: "high" }, 0);
        }
        break;
      } catch (e) {
        if (!(e instanceof FalError)) throw e;
        if (attempt === 0) {
          scene = await director.rephraseScene(scene);
          spec.scene = scene;
        }
        if (attempt === 2) throw e;
      }
    }
    spec.key_url = r!.images[0].url;
    this.checkpoint();
  }

  async keyframes() {
    this.log("keyframes", "Painting the keyframes (GPT Image 2.5)…");
    if (!this.st.specs) {
      const specs: Spec[] = this.plan.blocks.map((b, bi) => ({
        shot: b.shot,
        bi,
        scene: b.scene,
        talking: b.kind === "T",
        with_char: Boolean(b.character_in_shot ?? true) || b.kind === "T",
      }));
      specs.push({ shot: this.plan.tail.shot, bi: -1, scene: this.plan.tail.scene, talking: false, with_char: true });
      this.st.specs = specs;
    }
    await Promise.all(this.specs.map((s) => this.oneKey(s)));
    this.rec.assets.keyframes = Object.fromEntries(this.specs.map((s) => [s.shot, s.key_url]));
    this.log("keyframes", `${this.specs.length} keyframes ready`, { images: this.specs.map((s) => s.key_url!) });
  }

  async oneShot(spec: Spec, i: number) {
    if (spec.clip_url && spec.clip_dur) return;
    const b = this.blockOf(spec) as Block;
    type Video = { video: { url: string }; duration?: number };
    let r: Video;
    if (spec.talking) {
      r = await run<Video>(LIPSYNC, { image_url: spec.key_url, audio_url: b.audio_url, resolution: RES, enable_transcription: true });
    } else {
      let need: number;
      if (spec.shot === this.plan.tail.shot) {
        need = TAIL_DUR;
        if (!(b.action ?? "").endsWith(PULL_BACK)) b.action = (b.action ?? "") + PULL_BACK;
        b.camera = "slow pull-back";
      } else {
        need = b.audio_dur! + GAP + (i === 0 ? LEAD : 0);
      }
      const dur = shotDuration(need);
      b.scene = spec.scene;
      const refs = spec.with_char ? [spec.key_url, this.st.hero_url] : [spec.key_url];
      r = await run<Video>(R2V, {
        prompt: this.motionPrompt(b, spec.with_char),
        reference_image_urls: refs,
        aspect_ratio: "16:9",
        resolution: RES,
        duration: dur,
        prompt_expansion_mode: "disabled",
      });
    }
    spec.clip_url = r.video.url;
    spec.clip_dur = Number(r.duration ?? 0) || (await duration(spec.clip_url));
    this.checkpoint();
  }

  async showsSheet(clip: string) {
    if (!this.st.sheet_url) return false;
    const frames = (
      await Promise.all(
        ["first", "middle", "last"].map((frame_type) =>
          run<{ images: { url: string }[] }>(FRAME_AT, { video_url: clip, frame_type })
            .then((r) => r.images[0]?.url)
            .catch(() => undefined),
        ),
      )
    ).filter((u): u is string => !!u);
    if (!frames.length) return false;
    const r = await run<{ output: string }>(VISION, {
      model: CHECKER,
      reasoning: true,
      temperature: 0,
      max_tokens: 1500,
      system_prompt: SHEET_CHECK_SYSTEM,
      prompt: SHEET_CHECK_PROMPT,
      image_urls: [this.st.sheet_url, ...frames],
    });
    const text = r.output ?? "";
    return /"sheet"\s*:\s*true/i.test(text);
  }

  async checkShot(spec: Spec, i: number) {
    if (spec.talking || spec.checked || !spec.clip_url) return;
    try {
      if (!spec.reshot && (await this.showsSheet(spec.clip_url))) {
        spec.reshot = true;
        spec.clip_url = undefined;
        spec.clip_dur = undefined;
        this.checkpoint();
        await this.oneShot(spec, i);
        this.log("shots", `Refilmed shot ${spec.shot}`);
      }
      spec.raw_url ??= spec.clip_url;
      const sep = await run<{ residual: { url: string } }>(SEPARATE, {
        audio_url: spec.raw_url,
        prompt: SPEECH_PROMPT,
        output_format: "mp3",
        acceleration: "fast",
      });
      spec.clip_url = (await run<{ video: { url: string } }>(MERGE_AV, { video_url: spec.raw_url, audio_url: sep.residual.url })).video.url;
    } catch (e) {
      if (!(e instanceof FalError) || isKeyError(e)) throw e;
      spec.clip_url ??= spec.raw_url;
    }
    spec.checked = true;
    this.checkpoint();
  }

  async shots() {
    const nT = this.specs.filter((s) => s.talking).length;
    this.log("shots", `Filming ${this.specs.length - nT} H3 Max reference-to-video shots and ${nT} lip-sync shots…`);
    await Promise.all(this.specs.map((s, i) => this.oneShot(s, i)));
    this.log("shots", "Checking every shot…");
    await Promise.all(this.specs.map((s, i) => this.checkShot(s, i)));
    this.rec.assets.clips = Object.fromEntries(this.specs.map((s) => [s.shot, s.clip_url]));
    this.log("shots", "All shots are in the can", { videos: this.specs.map((s) => s.clip_url!) });
  }

  filmLength() {
    return LEAD + sum(this.plan.blocks.map((b) => b.audio_dur! + GAP)) + TAIL_DUR + END_CARD;
  }

  async music() {
    if (!this.st.music_url) {
      const r = await run<{ audio: { url: string } }>(MUSIC, {
        prompt: this.plan.music_prompt,
        music_length_ms: Math.min(600_000, ms(Math.max(30, this.filmLength() + 3))),
        force_instrumental: true,
        output_format: "mp3_48000_192",
      });

      const n = await run<{ audio: { url: string } }>(LOUDNORM, { audio_url: r.audio.url, integrated_loudness: MUSIC_LUFS, true_peak: -2 });
      this.st.music_url = n.audio.url;
      Object.assign(this.rec.assets, { music: r.audio.url, music_bed: this.st.music_url });
    }
    this.log("music", "Score composed (ElevenLabs Music)");
  }

  async endCard() {
    if (this.st.card_clip) return;
    const p = this.plan;
    const tailKey = this.specs.find((s) => s.shot === p.tail.shot)!.key_url!;
    const prompt = endCardPrompt(p.title, p.subtitle, this.style.anchor);
    let card: string;
    try {
      const r = await run<{ images: { url: string }[] }>(EDIT, { image_urls: [tailKey], prompt, image_size: FRAME, quality: "high" });
      card = r.images[0].url;
    } catch (e) {
      if (!(e instanceof FalError)) throw e;
      card = tailKey;
    }
    const v = await run<{ video: { url: string } }>(STILL, { fps: FPS, images: [{ url: card, frames: Math.round(END_CARD * FPS) }] });
    this.st.card_image = card;
    this.st.card_clip = v.video.url;
    this.rec.assets.end_card = card;
    this.checkpoint();
  }

  timeline() {
    const blocks = this.plan.blocks;
    const specs = Object.fromEntries(this.specs.map((s) => [s.shot, s]));
    const length: Record<string, number> = Object.fromEntries(blocks.map((b) => [b.id, b.kind === "T" ? specs[b.shot].clip_dur! : b.audio_dur!]));
    let t = LEAD;
    const starts: Record<string, number> = {};
    for (const b of blocks) {
      starts[b.id] = t;
      t += length[b.id] + GAP;
    }
    const tailStart = blocks[blocks.length - 1].kind === "T" ? t - GAP : t;
    const segments: { shot: string; start: number; dur: number; talking: boolean }[] = [];
    let vis = 0;
    blocks.forEach((b, i) => {
      let s0: number, d: number;
      if (b.kind === "T") {
        s0 = starts[b.id];
        d = length[b.id];
      } else {
        const nxt = blocks[i + 1];
        const end = !nxt ? tailStart : starts[nxt.id] - (nxt.kind === "V" ? GAP / 2 : 0);
        s0 = vis;
        d = end - vis;
      }
      segments.push({ shot: b.shot, start: s0, dur: d, talking: b.kind === "T" });
      vis = s0 + d;
    });
    segments.push({ shot: this.plan.tail.shot, start: tailStart, dur: TAIL_DUR, talking: false });
    return { starts, segments, pictureEnd: tailStart + TAIL_DUR };
  }

  async trimmed(seg: { shot: string; dur: number }) {
    const spec = this.specs.find((s) => s.shot === seg.shot)!;
    const d = Math.min(seg.dur, spec.clip_dur!);
    if (spec.clip_dur! - d < 0.05) return spec.clip_url!;
    const r = await run<{ video: { url: string } }>(TRIM, { video_url: spec.clip_url, start_time: 0, duration: Math.round(d * 1000) / 1000 });
    return r.video.url;
  }

  async assemble() {
    const p = this.plan;
    const { starts, segments, pictureEnd } = this.timeline();
    const total = pictureEnd + END_CARD;
    this.log("assemble", `Cutting ${segments.length} shots on fal (trim + merge + compose)…`);
    const cut = await Promise.all(segments.map((s) => this.trimmed(s)));

    const picture = (await run<{ video: { url: string } }>(MERGE, { video_urls: [...cut, this.st.card_clip], target_fps: FPS, resolution: FRAME })).video
      .url;

    const tracks = [
      { id: "picture", type: "video", keyframes: [{ timestamp: 0, duration: ms(total), url: picture }] },
      { id: "picture-sound", type: "audio", keyframes: [{ timestamp: 0, duration: ms(total), url: picture }] },
      ...p.blocks
        .filter((b) => b.kind === "V")
        .map((b) => ({ id: `vo-${b.id}`, type: "audio", keyframes: [{ timestamp: ms(starts[b.id]), duration: ms(b.audio_dur!), url: b.audio_url }] })),
      { id: "music", type: "audio", keyframes: [{ timestamp: 0, duration: ms(total), url: this.st.music_url }] },
    ];
    const composed = (await run<{ video_url: string }>(COMPOSE, { tracks })).video_url;
    Object.assign(this.rec.assets, { cuts: Object.fromEntries(segments.map((s, i) => [s.shot, cut[i]])), picture });

    this.log("assemble", "Balancing the sound (loudness-normalised mix)…");
    const mix = await run<{ audio: { url: string } }>(LOUDNORM, { audio_url: composed, integrated_loudness: FINAL_LUFS, true_peak: -1.5 });
    let clean = (await run<{ video: { url: string } }>(MERGE_AV, { video_url: composed, audio_url: mix.audio.url })).video.url;
    if ((await duration(clean)) > total + 0.3)
      clean = (await run<{ video: { url: string } }>(TRIM, { video_url: clean, start_time: 0, duration: Math.round(total * 1000) / 1000 })).video.url;

    this.log("subtitles", "Adding word-by-word subtitles (fal auto-subtitle)…");
    const { languages } = await studioData();
    let r: { video: { url: string }; subtitle_count?: number };
    try {
      r = await run<{ video: { url: string }; subtitle_count?: number }>(SUBTITLE, {
        video_url: clean,
        ...subtitleInput(this.rec.lang, languages.find((l) => l.code === this.rec.lang)?.font ?? "Nunito", this.style.palette?.accent ?? "#f0a45a"),
      });
    } catch (e) {
      if (!(e instanceof FalError)) throw e;

      this.log("subtitles", "Subtitles unavailable for this language, keeping the clean cut");
      r = { video: { url: clean }, subtitle_count: 0 };
    }
    Object.assign(this.rec.assets, { composed, clean, film: r.video.url });
    this.rec.result = {
      title: `${p.title} ${p.subtitle}`,
      video: r.video.url,
      clean,
      poster: this.st.card_image,
      duration: Math.round(total * 10) / 10,
      subtitle_count: r.subtitle_count,
    };
    this.log("done", `Done: ${total.toFixed(1)} s film`);
  }

  record(): FilmRecord {
    const p = this.st.plan;
    return {
      ...this.rec,
      style_label: this.style?.label ?? this.rec.style,
      title: p?.title ?? "",
      subtitle: p?.subtitle ?? "",
      narrator: p?.character ?? {},
      voice_id: p?.voice_id ?? "",
      blocks: (p?.blocks ?? []).map((b) => ({ kind: b.kind, text: b.text })),
      state: this.st,
    };
  }
}

const NAMED: Record<string, [number, number, number]> = {
  white: [255, 255, 255],
  yellow: [255, 221, 0],
  orange: [255, 150, 30],
  red: [230, 50, 40],
  pink: [255, 110, 170],
  purple: [150, 80, 220],
  blue: [40, 110, 240],
  cyan: [40, 210, 230],
  green: [60, 200, 90],
  magenta: [230, 40, 200],
};

export function namedColor(hex: string) {
  const h = hex.replace(/^#/, "");
  const rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  if (h.length < 6 || rgb.some(Number.isNaN)) return "yellow";
  let best = "yellow",
    dist = Infinity;
  for (const [name, c] of Object.entries(NAMED)) {
    if (name === "white") continue;
    const d = sum(c.map((v, i) => (v - rgb[i]) ** 2));
    if (d < dist) [best, dist] = [name, d];
  }
  return best;
}

let chain: Promise<unknown> = Promise.resolve();

export function runFilm(rec: FilmRecord, onEvent: (e: JobEvent, rec: FilmRecord) => void): Promise<FilmRecord> {
  const film = new Film(rec, onEvent);
  const job = chain.then(async () => {
    rec.status = "running";
    rec.error = "";
    try {
      await film.run();
      rec.status = "done";
    } catch (e) {
      rec.status = "error";
      rec.error = String(e instanceof Error ? e.message : e).slice(0, 2000);
      film.log("error", `Failed: ${rec.error.slice(0, 500)}`);
    } finally {
      await film.checkpoint();
      await saveRecord(film.record());
    }
    return film.record();
  });
  chain = job.catch(() => {});
  return job;
}
