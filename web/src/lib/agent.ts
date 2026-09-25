import { useSyncExternalStore } from "react";
import type { Film } from "@/lib/api";
import { REPO_URL } from "@/lib/share";
import { studioData, type StudioData } from "@/lib/studio/data";
import * as D from "@/lib/studio/director";
import * as P from "@/lib/studio/pipeline";
import { checkVoice } from "@/lib/studio/voices";

export type AgentContext =
  | {
      kind: "create";
      topic: string;
      style: string;
      styleUrl: string;
      minutes: number;
      language: string;
      characterId: string;
      characterUrl: string;
      characterName: string;
      voice: { voice_id: string; name: string } | null;
      resolution: P.Resolution;
    }
  | { kind: "film"; film: Film };

let current: AgentContext | null = null;
const listeners = new Set<() => void>();

export function setAgentContext(context: AgentContext | null) {
  current = context;
  listeners.forEach((l) => l());
}

export function useAgentContext() {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => current,
  );
}

type Look = StudioData["styles"][number];
type Cast = StudioData["characters"][number];
type VoiceInfo = { voice_id: string; name: string; gender?: string; age?: string; accent?: string; description?: string };

const abs = (url: string) => (!url ? "" : url.startsWith("http") ? url : `${window.location.origin}${url}`);
const json = (x: unknown) => JSON.stringify(x);
const fence = (lang: string, body: string) => ["```" + lang, body, "```"];

async function resolve(ctx: AgentContext | null, data: StudioData) {
  let topic = "";
  let minutes = 1;
  let lang = "en";
  let look: Look | null = null;
  let customLook = "";
  let narrator: Cast | null = null;
  let uploaded: { url: string; name: string } | null = null;
  let voice: VoiceInfo | null = null;
  let voiceNote = "";
  let reference: Film | null = null;

  if (ctx?.kind === "film") {
    reference = ctx.film;
    lang = ctx.film.lang || "en";
    minutes = ctx.film.minutes ?? Math.max(1, Math.round(ctx.film.duration / 60));
    narrator = data.characters.find((c) => c.id === ctx.film.character_id) ?? null;
    look = data.styles.find((s) => s.id === (narrator?.style ?? ctx.film.style)) ?? null;
    const used = ctx.film.voice ? (await checkVoice({ name: ctx.film.voice }, lang)).voice : null;
    if (used) voice = { voice_id: used.voice_id, name: used.name, gender: used.gender, age: used.age, accent: used.accent, description: used.description };
  } else if (ctx?.kind === "create") {
    topic = ctx.topic;
    minutes = ctx.minutes;
    lang = ctx.language;
    narrator = data.characters.find((c) => c.id === ctx.characterId) ?? null;
    look = data.styles.find((s) => s.id === (narrator?.style ?? ctx.style)) ?? null;
    if (!narrator && ctx.style === "custom") customLook = ctx.styleUrl;
    if (!narrator && ctx.characterUrl) uploaded = { url: ctx.characterUrl, name: ctx.characterName };
    if (ctx.voice) {
      const rec = (await checkVoice({ id: ctx.voice.voice_id }, lang)).voice;
      voice = rec ? { voice_id: rec.voice_id, name: rec.name, gender: rec.gender, age: rec.age, accent: rec.accent, description: rec.description } : ctx.voice;
    }
  }

  if (narrator && !voice) {
    voice = { ...narrator.voice };
    const check = await checkVoice({ id: narrator.voice.voice_id }, lang);
    if (check.voice && !check.speaks) {
      const alt = check.native;
      if (alt) {
        voiceNote = `${narrator.name}'s own voice is not made for this language, so ${alt.name.split(" - ")[0]} narrates instead.`;
        voice = { voice_id: alt.voice_id, name: alt.name, gender: alt.gender, age: alt.age, accent: alt.accent, description: alt.description };
      }
    }
  }
  const res: P.Resolution = ctx?.kind === "create" && ctx.resolution === "480P" ? "480P" : "768P";
  return { topic, minutes, lang, look, customLook, narrator, uploaded, voice, voiceNote, reference, res };
}

export async function agentSummary(ctx: AgentContext | null) {
  if (!ctx) return "";
  const data = await studioData();
  const r = await resolve(ctx, data);
  return [r.reference ? `like ${r.reference.title}` : r.topic, r.look?.label, r.narrator?.name].filter(Boolean).join(" · ");
}

export async function agentBrief(ctx: AgentContext | null): Promise<string> {
  const data = await studioData();
  const r = await resolve(ctx, data);
  const origin = window.location.origin;
  const [blocks, talk] = D.shape(r.minutes);
  const language = data.languages.find((l) => l.code === r.lang);
  const font = language?.font ?? "Nunito";
  const firstCurated = Object.keys(data.curated_voices)[0];

  const look: Look = r.look ?? {
    id: "",
    label: "{LOOK_LABEL}",
    thumb: "",
    category: "",
    blurb: "",
    anchor: "{ANCHOR}",
    motion: "{MOTION}",
    character_hint: "{CHARACTER_HINT}",
    palette: { bg: "", text: "", accent: "#f0a45a" },
    ref: "",
  };
  const given: D.Given | null = r.narrator
    ? { name: r.narrator.name, traits: r.narrator.traits, pronoun: r.narrator.pronoun, personality: r.narrator.personality }
    : r.uploaded
      ? { name: r.uploaded.name || "{NAME}", traits: "{TRAITS}", pronoun: "{PRONOUN}" }
      : null;
  const who = given ?? { name: "{NAME}", traits: "{TRAITS}", pronoun: "{PRONOUN}" };
  const styleRef = r.customLook || (r.look?.ref ? abs(r.look.ref) : "");
  const hasRef = Boolean(styleRef) || !r.look;
  const system = await D.directorSystem(look, r.minutes, r.lang, given, r.voice);
  const continuity = await D.continuityPrompt("{SCRIPT_JSON}", r.minutes, r.lang, Math.max(1, Math.min(Math.floor(blocks / 5), 64 - blocks)));
  const [sheetPrompt, heroPrompt] = P.characterPrompts(`${who.name.toUpperCase()}, ${who.traits}`, look.anchor);
  const L: string[] = [];
  const add = (...lines: string[]) => L.push(...lines);

  add(
    "# Make a Storycast film",
    "",
    "Make a short narrated animated film on fal exactly the way Storycast does it. Follow the steps in order, run independent calls in parallel,",
    "keep every URL fal returns, and show the user the script before you spend on video.",
    "",
    "## Setup",
    "",
    "- Use the user's fal key (`FAL_KEY`). Call every endpoint below through the fal MCP server, `@fal-ai/client` (`fal.subscribe(endpoint, { input })`)",
    "  or the queue API (`https://queue.fal.run/<endpoint>`). Upload local files with `fal.storage.upload`.",
    "- Measure the length of every audio and video file you get back (ffprobe or the `duration` field) and keep it.",
    `- Catalog: ${origin}/data/config.json (looks, narrators with their ElevenLabs voice ids, languages, camera moves; paths are relative to ${origin}).`,
    "- Voices: use the narrator's own voice. For any other voice, take its voice id from the ElevenLabs Voice Library (https://elevenlabs.io/app/voice-library).",
    `- Source of this pipeline: ${REPO_URL}/tree/main/web/src/lib/studio`,
    "",
    "## Inputs",
    "",
  );

  if (r.reference) {
    const f = r.reference;
    add(`- A new film in the manner of "${f.title} ${f.subtitle}" (${origin}/films/${f.id}), same look, narrator and voice. Ask the user for the topic (the original was: ${f.topic}).`);
  } else add(`- Topic: ${r.topic || "ask the user"}`);
  add(`- Length: ${r.minutes} min (${blocks} blocks, ${talk} on camera)`, `- Language: ${language?.name ?? "English"}, code \`${r.lang}\`, subtitle font \`${font}\``, `- Resolution: ${r.res}`);

  if (r.look) {
    add(`- Look: ${r.look.label}`, `  - anchor: ${json(r.look.anchor)}`, `  - motion: ${json(r.look.motion)}`, `  - style reference image: ${styleRef}`, `  - palette: ${json(r.look.palette)}`);
  } else if (r.customLook) {
    add(`- Look: the user's own illustration: ${r.customLook} (step 0 turns it into a look)`);
  } else {
    add("- Look: ask the user, or pick one from `styles` in config.json. Use its `label`, `anchor`, `motion`, `character_hint`, `palette` and `ref` (the style reference image) wherever {LOOK_LABEL}, {ANCHOR}, {MOTION} and {CHARACTER_HINT} appear.");
  }

  if (r.narrator) {
    const c = r.narrator;
    add(`- Narrator: ${c.name} (${c.personality})`, `  - traits: ${json(c.traits)}, pronoun: ${c.pronoun}`, `  - hero portrait: ${abs(c.hero)}`, `  - model sheet: ${abs(c.sheet)}`);
  } else if (r.uploaded) {
    add(`- Narrator: the user's character${r.uploaded.name ? ` "${r.uploaded.name}"` : ""}: ${r.uploaded.url} (step 0 describes it)`);
  } else {
    add("- Narrator: invented by the director in step 1.");
  }
  if (r.voice) add(`- Voice: ElevenLabs \`${r.voice.voice_id}\` (${r.voice.name})${r.voiceNote ? `. ${r.voiceNote}` : ""}`);
  else add("- Voice: chosen by the director in step 1 from the list in its instructions, unless the user picks one from the ElevenLabs Voice Library.");

  if (r.reference?.script.length) {
    add("", "The original script, for tone only:", "", ...r.reference.script.map((t, i) => `${i + 1}. [${r.reference!.kinds[i] ?? "V"}] ${t}`));
  }

  add("", "## How to call the director", "");
  add(
    `Every text step uses \`openrouter/router\` with \`{model: "${D.DIRECTOR_MODEL}", system_prompt, prompt, max_tokens, reasoning: true}\`; image steps use`,
    `\`openrouter/router/vision\` with the same fields plus \`image_urls\` and \`max_tokens: 6000\`. Read \`output\`, strip any markdown fence and parse the JSON`,
    'between the first "{" and the last "}". If it does not parse, ask once more with "\\n\\nYour previous answer was not valid JSON. Return ONLY the JSON object."',
    'appended to the prompt (for vision: "\\n\\nReturn ONLY the JSON object.").',
  );

  if (r.customLook || r.uploaded) {
    add("", "## 0. Read the user's images", "");
    if (r.customLook)
      add(
        `Look: vision call with \`image_urls: [${json(r.customLook)}]\`, system ${json(D.STYLE_SYSTEM)} and prompt:`,
        "",
        ...fence("text", D.STYLE_PROMPT),
        "",
        'Use `label`, `anchor`, `motion`, `character_hint` (default "an original narrator that belongs to this world") and `palette` (default {"bg": "#141414", "text": "#f6f1e8", "accent": "#f0a45a"}) as the look. The user\'s image is the style reference image.',
      );
    if (r.uploaded)
      add(
        "",
        `Narrator: vision call with \`image_urls: [${json(r.uploaded.url)}]\`, system ${json(D.CHARACTER_SYSTEM)} and prompt:`,
        "",
        ...fence("text", D.characterDescribePrompt(r.uploaded.name)),
        "",
        "The returned `name`, `traits` and `pronoun` are the narrator's {NAME}, {TRAITS} and {PRONOUN}.",
      );
  }

  add(
    "",
    "## 1. Script",
    "",
    `Director call, \`max_tokens: ${Math.min(64000, 6000 + 900 * blocks)}\`, prompt \`TOPIC: <topic>\`, system prompt:`,
    "",
    ...fence("text", system),
    "",
    "Then:",
    "- The first block must be V, otherwise ask again. Set `character_in_shot: true` on every T block.",
    given ? "- Overwrite `character` with the given name, traits and pronoun." : "- `character` now holds the narrator: {NAME}, {TRAITS}, {PRONOUN}.",
    r.voice ? `- Set \`voice_id\` to \`${r.voice.voice_id}\`.` : `- If \`voice_id\` is not one of the curated ids, use \`${firstCurated}\`.`,
  );

  add(
    "",
    "## 2. Script edit",
    "",
    `Director call, system ${json(D.CONTINUITY_SYSTEM)}, \`max_tokens: min(32000, 6000 + 500 × blocks)\`, prompt below with {SCRIPT_JSON} =`,
    "`[{index, kind, place, text, scene}]` of every block (up to floor(blocks / 5) inserts, at least 1; the number below is for the planned length):",
    "",
    ...fence("text", continuity),
    "",
    "Apply each edit (`text`, `scene`, `place` when non-empty) to the block at `index`. Insert each valid insert (0 ≤ after < blocks, with text and scene) as a new V block after",
    'block `after`, from the highest `after` down; missing fields default to action "The character moves on through the scene.", camera "gentle drift", sound',
    '"soft ambience", character_in_shot true. If the call fails, keep the script.',
    "",
    "Number the blocks B01, B02, …; each block's shot is S01 (V) or T02 (T) with the same number; the tail's shot is S(blocks + 1).",
  );

  add("", "## 3. Narrator images", "");
  if (r.narrator) add("Use the hero portrait and model sheet from the inputs.");
  else {
    const refs = [r.uploaded ? "the user's character" : "", hasRef ? "the style reference" : ""].filter(Boolean);
    add(
      refs.length
        ? `\`${P.EDIT}\` with \`image_urls: [${refs.join(", ")}]\` and each prompt prefixed with ${[r.uploaded ? json(P.CHARACTER_REF_NOTE) : "", hasRef ? json(`Image ${refs.length} ${P.STYLE_REF_NOTE}.`) : ""].filter(Boolean).join(" + ")} and a space.`
        : `\`${P.T2I}\`.`,
      `Both calls \`quality: "high"\`, in parallel.`,
      "",
      `- model sheet, \`image_size: ${json(P.WIDE)}\`:`,
      ...fence("text", sheetPrompt),
      `- hero portrait, \`image_size: ${json(P.PORTRAIT)}\`:`,
      ...fence("text", heroPrompt),
    );
  }

  add(
    "",
    "## 4. Narration",
    "",
    `\`${P.TTS}\` for every block in parallel: \`{text, voice: voice_id, stability: 0.5, language_code: "${r.lang}"}\`; keep \`audio.url\` and its duration.`,
    `If the voice is not found on fal, switch to \`${firstCurated}\` for the whole film.`,
    `A T block must be 5.2-14.6 s long. If not, rewrite it (director call, system ${json(D.RESIZE_SYSTEM)}, \`max_tokens: 2000\`, prompt below with`,
    '{WANT} = "shorter" above 12 s, otherwise "longer") and record it again, at most twice; if it is still out of range, it becomes a V block (shot S…, action',
    '"The character gestures while the scene breathes with small ambient motion." if empty).',
    "",
    ...fence("text", D.resizePrompt("{TEXT}", "{SECONDS}", "{WANT}", language?.name ?? "English")),
  );

  const urlsWith = `[model sheet, hero${hasRef ? ", style reference" : ""}]`;
  add(
    "",
    "## 5. Keyframes",
    "",
    `One per block plus the tail (the tail always has the narrator). \`${P.EDIT}\`, \`image_size: ${json(P.WIDE)}\`, \`quality: "high"\`, all in parallel.`,
    `- With the narrator (\`character_in_shot\`, always for T): \`image_urls: ${urlsWith}\`.`,
    `- Without: \`image_urls: [${hasRef ? "style reference" : "model sheet"}]\`.`,
    "",
    "V block with the narrator, and the tail:",
    ...fence("text", P.keyframePrompt(who, look.anchor, hasRef, "{SCENE}", true, false)),
    "T block:",
    ...fence("text", P.keyframePrompt(who, look.anchor, hasRef, "{SCENE}", true, true)),
    "Without the narrator:",
    ...fence("text", P.keyframePrompt(who, look.anchor, hasRef, "{SCENE}", false, false)),
    "",
    `If a call is rejected, rewrite the scene once (director call, system ${json(D.REPHRASE_SYSTEM)}, \`max_tokens: 2000\`, prompt below) and try again;`,
    `if that fails too, make it with \`${P.T2I}\` and the prompt "{SCENE} No readable text anywhere. ${look.anchor}" and treat it as a shot without the narrator.`,
    "",
    ...fence("text", D.rephrasePrompt("{SCENE}")),
  );

  add(
    "",
    "## 6. Shots",
    "",
    `- T blocks: \`${P.LIPSYNC}\` \`{image_url: keyframe, audio_url: narration, resolution: "${r.res}", enable_transcription: true}\`. Its length is the T slot.`,
    `- V blocks: \`${P.R2V}\` \`{prompt, reference_image_urls: [keyframe, hero] (just [keyframe] without the narrator), aspect_ratio: "16:9", resolution: "${r.res}",`,
    `  duration, prompt_expansion_mode: "disabled"}\`. duration = clamp(ceil(need) + 1, 5, 15) with need = narration + ${P.GAP} s (+ ${P.LEAD} s for the first block).`,
    `- Tail: the same with need = ${P.TAIL_DUR} s, camera "slow pull-back" and this appended to its action: ${json(P.PULL_BACK.trim())}`,
    "",
    "Shot prompt ({SCENE} is the scene its keyframe was made from; {ACTION} {CAMERA}. ends with a single period):",
    ...fence("text", P.shotPrompt(who, look.motion, { scene: "{SCENE}", action: "{ACTION}", camera: "{CAMERA}", sound: "{SOUND}" }, true)),
    "Without the narrator:",
    ...fence("text", P.shotPrompt(who, look.motion, { scene: "{SCENE}", action: "{ACTION}", camera: "{CAMERA}", sound: "{SOUND}" }, false)),
    "",
    "Then check every V shot and the tail, in parallel:",
    `1. \`${P.FRAME_AT}\` \`{video_url, frame_type}\` for "first", "middle" and "last"; then \`${P.VISION}\` \`{model: "${P.CHECKER}", reasoning: true, temperature: 0,`,
    `   max_tokens: 1500, system_prompt: ${json(P.SHEET_CHECK_SYSTEM)}, image_urls: [model sheet, ...frames], prompt}\` with the prompt below. If the answer has`,
    '   "sheet": true, film the shot again once.',
    `2. Keep only ambient sound in the shot: \`${P.SEPARATE}\` \`{audio_url: shot, prompt: ${json(P.SPEECH_PROMPT)}, output_format: "mp3", acceleration: "fast"}\`,`,
    `   then \`${P.MERGE_AV}\` \`{video_url: shot, audio_url: residual.url}\`. If this fails, keep the shot as it is.`,
    "",
    ...fence("text", P.SHEET_CHECK_PROMPT),
  );

  add(
    "",
    "## 7. Music",
    "",
    `Film length = ${P.LEAD} + Σ(narration + ${P.GAP}) + ${P.TAIL_DUR} + ${P.END_CARD} s. \`${P.MUSIC}\` \`{prompt: music_prompt, music_length_ms: min(600000, max(30, film length + 3) × 1000),`,
    `force_instrumental: true, output_format: "mp3_48000_192"}\`, then \`${P.LOUDNORM}\` \`{audio_url, integrated_loudness: ${P.MUSIC_LUFS}, true_peak: -2}\`.`,
    "",
    "## 8. End card",
    "",
    `\`${P.EDIT}\` \`{image_urls: [tail keyframe], image_size: ${json(P.FRAME)}, quality: "high", prompt}\` (on failure use the tail keyframe as it is), then`,
    `\`${P.STILL}\` \`{fps: ${P.FPS}, images: [{url, frames: ${Math.round(P.END_CARD * P.FPS)}}]}\`.`,
    ...fence("text", P.endCardPrompt("{TITLE}", "{SUBTITLE}", look.anchor)),
  );

  add(
    "",
    "## 9. Edit",
    "",
    "Timeline (seconds):",
    ...fence(
      "text",
      [
        `slot(b) = T ? lip-sync shot length : narration length`,
        `t = ${P.LEAD}; for each block b: start[b] = t; t += slot(b) + ${P.GAP}`,
        `tailStart = last block is T ? t - ${P.GAP} : t`,
        `picture segments, in order (vis = 0):`,
        `  T block: from start[b] for slot(b)`,
        `  V block: from vis until (next block ? start[next] - (next is V ? ${P.GAP / 2} : 0) : tailStart)`,
        `  vis = end of the segment`,
        `tail: from tailStart for ${P.TAIL_DUR}; end card after it for ${P.END_CARD}; total = tailStart + ${P.TAIL_DUR + P.END_CARD}`,
      ].join("\n"),
    ),
    `1. Cut every shot to its segment: d = min(segment, shot length); if the shot is more than 0.05 s longer, \`${P.TRIM}\` \`{video_url, start_time: 0, duration: d}\`.`,
    `2. \`${P.MERGE}\` \`{video_urls: [...cuts, end card clip], target_fps: ${P.FPS}, resolution: ${json(P.PICTURE[r.res])}}\` → picture.`,
    `3. \`${P.COMPOSE}\` \`{tracks}\` → \`video_url\`, times in ms:`,
    ...fence(
      "json",
      json([
        { id: "picture", type: "video", keyframes: [{ timestamp: 0, duration: "{TOTAL_MS}", url: "{PICTURE}" }] },
        { id: "picture-sound", type: "audio", keyframes: [{ timestamp: 0, duration: "{TOTAL_MS}", url: "{PICTURE}" }] },
        { id: "vo-B01", type: "audio", keyframes: [{ timestamp: "{START_MS of each V block}", duration: "{NARRATION_MS}", url: "{NARRATION}" }] },
        { id: "music", type: "audio", keyframes: [{ timestamp: 0, duration: "{TOTAL_MS}", url: "{MUSIC}" }] },
      ]),
    ),
    "   One vo track per V block; T narration is already in its lip-sync shot.",
    `4. \`${P.LOUDNORM}\` \`{audio_url: composed, integrated_loudness: ${P.FINAL_LUFS}, true_peak: -1.5}\`, then \`${P.MERGE_AV}\` \`{video_url: composed, audio_url}\` → the clean cut.`,
    `   If it is more than 0.3 s longer than total, \`${P.TRIM}\` it to total.`,
  );

  const sub = P.subtitleInput(r.lang, font, look.palette?.accent ?? "#f0a45a", P.PICTURE[r.res].height);
  add(
    "",
    "## 10. Subtitles",
    "",
    `\`${P.SUBTITLE}\` \`${json({ video_url: "{CLEAN_CUT}", ...sub })}\`${r.look ? "" : " (highlight_color: the palette accent mapped to the nearest of yellow, orange, red, pink, purple, blue, cyan, green, magenta)"}.`,
    "If the language is not supported, the clean cut is the film.",
    "",
    'Give the user the film, the clean cut and the script. The title is "{TITLE} {SUBTITLE}".',
  );
  return L.join("\n");
}
