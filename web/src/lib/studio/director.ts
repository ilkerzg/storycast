import { run } from "./fal";
import { studioData, type StyleFull } from "./data";

export const DIRECTOR_MODEL = "anthropic/claude-opus-5.5";

export type Given = { name: string; traits: string; pronoun: string; personality?: string };
export type GivenVoice = { voice_id: string; name?: string; gender?: string; age?: string; accent?: string; description?: string; descriptive?: string };
export type Block = {
  kind: "V" | "T";
  text: string;
  place?: string;
  scene: string;
  character_in_shot: boolean;
  action: string;
  camera: string;
  sound: string;
  id: string;
  shot: string;
  audio_url?: string;
  audio_dur?: number;
};
export type Tail = { scene: string; action: string; camera: string; sound: string; shot: string };
export type Plan = {
  title: string;
  subtitle: string;
  slug: string;
  character: { name: string; traits: string; pronoun: string };
  voice_id: string;
  music_prompt: string;
  blocks: Block[];
  tail: Tail;
  continuity?: { rewrites: number; bridges: number };
};

export function shape(minutes: number): [number, number] {
  const n = minutes <= 1 ? 5 : 6 * minutes;
  return [n, Math.max(2, Math.round(n / 3))];
}

export function words(minutes: number): [string, string] {
  return minutes <= 1 ? ["14-22", "16-24"] : ["18-32", "18-30"];
}

async function languageName(lang: string) {
  return (await studioData()).languages.find((l) => l.code === lang)?.name ?? "English";
}

const quotedList = (xs: string[]) => `[${xs.map((x) => `'${x}'`).join(", ")}]`;

export async function directorSystem(style: StyleFull, minutes: number, lang: string, character?: Given | null, voice?: GivenVoice | null) {
  const { cameras, curated_voices } = await studioData();
  const [n, talk] = shape(minutes);
  let charRule: string;
  if (character) {
    charRule =
      `- The narrator is GIVEN: name "${character.name}", traits "${character.traits}", pronoun "${character.pronoun}". ` +
      'Copy these three values exactly into "character"; place this character naturally in every scene of the style world.';
    if (character.personality)
      charRule += ` Personality: ${character.personality}. Let it shape the voice, the jokes and what ${character.name} notices.`;
  } else {
    charRule = `- The narrator is ONE original character invented for this topic whose design belongs to the style world: ${style.character_hint}. Give it a short, memorable name. "traits" is ONE comma-separated string of 6-8 concrete visual traits (body, colors, material, clothing, one or two props). It must include a clearly visible mouth (needed for lip-sync). This exact string is pasted into every image prompt, so be specific and stable.`;
  }
  const [vw, tw] = words(minutes);
  const voices = Object.entries(curated_voices)
    .map(([vid, desc]) => `- ${vid}: ${desc}`)
    .join("\n");
  let voiceRule: string;
  if (voice) {
    const about = (["gender", "age", "accent", "descriptive"] as const)
      .filter((k) => voice[k])
      .map((k) => String(voice[k]))
      .join(", ");
    voiceRule =
      `- "voice_id": the narrator voice is GIVEN: "${voice.voice_id}" (${voice.name ?? ""}; ${about}; ` +
      `${(voice.description || "").slice(0, 300)}). Copy the id exactly, and make the narrator a character that plausibly has this voice.`;
  } else {
    voiceRule = `- "voice_id": pick the best matching voice for the character from:\n${voices}`;
  }
  const language = await languageName(lang);
  return `You are the director of a short narrated character film. One original character narrates a story that explains a topic to a general audience. Visual style: ${style.label}.
Return ONLY one JSON object, no prose, no markdown fences.

RULES
${charRule}
- Script: exactly ${n} blocks, exactly ${talk} of them "T" (the character talks on camera); the rest are "V" (voice-over under cinematic shots). Block 1 is "V" and the last block is "V". Beyond that the story is yours: structure, tone, jokes, twists and how the character enters are your creative choices.
- Text length: V blocks ${vw} words; T blocks ${tw} words. Language of all narration: ${language}. Spoken rhythm, one idea per block. Facts must be accurate; hedge legends and uncertain claims ("legend says").
- Continuity: the film is one continuous story. Every block grows out of the one before it in place, time and logic. Whenever the setting, the time or the subject changes, the viewer sees or hears how and why we got there; never cut to a new place, companion or subject as if the viewer already knew. How you bridge is up to this story.
- Stay inside the story: never say "this video" and never state how long the film is.
- For every block:
  - "place": a short label of where and when the block happens.
  - "scene": one paragraph (40-80 words) describing the keyframe: setting, era, lighting, composition, props, and what the character is doing. Everything exists in the style world (${style.label}). For T blocks describe the setting and one gesture only; the character faces the camera in a medium close-up, talking.
  - "character_in_shot": true or false (T blocks are always true; at most 2 V blocks may be false).
  - "action": 2-3 short present-tense motion beats for the video, including one small charming or comic beat (V blocks only; "" for T).
  - "camera": one of ${quotedList(cameras)}. Never use a push-in when the character is in shot.
  - "sound": ambient foley for the shot (no music, no speech).
- NEVER put readable text, signs, labels, screens with words, or numbers in any scene. At most ONE block may show one big simple word or year if it is essential; then write "shows only the large letters X" in its scene.
- Describe real people generically (no likeness), no brand logos, no violence or danger to children.
- "tail": the final shot after the last block: the character in a wide shot saying goodbye or resolving the story, with calm open space in the upper third for the title. Give "scene", "action", "camera" (prefer "slow pull-back"), "sound".
${voiceRule}
- "music_prompt": an instrumental score description fitting the style and topic: 3-5 acoustic instruments, mood arc, sparse under narration, a warm swell in the final twenty seconds ending on a soft resolved chord. End with "Acoustic instruments only, no vocals."
- "title": the character's name. "subtitle": a short lowercase phrase starting with "and the ..." (in ${language}). "slug": 3-5 word ascii kebab-case.

JSON SHAPE
{"title": "", "subtitle": "", "slug": "", "character": {"name": "", "traits": "", "pronoun": "his|her|its"}, "voice_id": "", "music_prompt": "",
 "blocks": [{"kind": "V|T", "text": "", "place": "", "scene": "", "character_in_shot": true, "action": "", "camera": "", "sound": ""}],
 "tail": {"scene": "", "action": "", "camera": "", "sound": ""}}`;
}

function parse(text: string): any {
  let t = text.trim();
  const m = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (m) t = m[1];
  return JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1));
}

async function ask(system: string, prompt: string, maxTokens = 16000): Promise<any> {
  let last: unknown;
  for (let i = 0; i < 2; i++) {
    const r = await run<{ output?: string }>("openrouter/router", {
      model: DIRECTOR_MODEL,
      system_prompt: system,
      prompt,
      max_tokens: maxTokens,
      reasoning: true,
    });
    try {
      return parse(r.output || "");
    } catch (e) {
      last = e;
      prompt += "\n\nYour previous answer was not valid JSON. Return ONLY the JSON object.";
    }
  }
  throw new Error(`director returned invalid JSON: ${last}`);
}

export async function plan(topic: string, style: StyleFull, minutes: number, lang: string, character?: Given | null, voice?: GivenVoice | null): Promise<Plan> {
  const [n] = shape(minutes);
  const { curated_voices } = await studioData();

  const p = await ask(await directorSystem(style, minutes, lang, character, voice), `TOPIC: ${topic}`, Math.min(64000, 6000 + 900 * n));
  if (character) p.character = { name: character.name, traits: character.traits, pronoun: character.pronoun };
  const blocks: Block[] = p.blocks || [];
  if (!blocks.length || blocks[0].kind !== "V") throw new Error("director plan invalid: first block must be V");
  for (const b of blocks) if (b.kind === "T") b.character_in_shot = true;
  const before = blocks.map((b) => b.text + b.scene);
  p.blocks = await continuity(blocks, minutes, lang);
  const inserted = p.blocks.length - blocks.length;
  p.continuity = { rewrites: p.blocks.filter((b: Block) => before.includes(b.text + b.scene) === false).length - inserted, bridges: inserted };
  if (voice) p.voice_id = voice.voice_id;
  else if (!(p.voice_id in curated_voices)) p.voice_id = Object.keys(curated_voices)[0];
  p.slug =
    String(p.slug || p.title || "film")
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "film";
  return p as Plan;
}

export const CONTINUITY_SYSTEM = "You are the script editor of a short narrated character film. You protect the viewer's sense of flow. Return ONLY JSON.";

export async function continuityPrompt(script: string, minutes: number, lang: string, most: number) {
  const { cameras } = await studioData();
  const [vw, tw] = words(minutes);
  return (
    "Here is the script as blocks (kind V = voice-over, T = the narrator talks on camera).\n" +
    "Watch it in your head as a first-time viewer who only sees and hears what is on screen. Wherever the film jumps (a new place, time, " +
    'subject or companion appears) and that viewer would ask "wait, how did we get here?" or "why are we talking about this now?", ' +
    "repair the flow so every block grows out of the one before. How you bridge is your choice and should fit this particular story. " +
    `You may rewrite the text and scene of the blocks around a jump, and you may insert up to ${most} new V blocks where the story needs a ` +
    "moment to travel or explain. Leave blocks that already flow untouched. Keep the narration language " +
    `(${await languageName(lang)}), the narrator, the facts, ${vw} words for V and ${tw} words for T blocks, and no readable text in scenes.\n` +
    `SCRIPT: ${script}\n` +
    'Return {"edits": [{"index": 0, "text": "", "scene": "", "place": ""}], ' +
    '"inserts": [{"after": 0, "text": "", "place": "", "scene": "", "character_in_shot": true, "action": "", "camera": "", "sound": ""}]} ' +
    `("camera" one of ${quotedList(cameras)}). Use empty lists when the script already flows.`
  );
}

export async function continuity(blocks: Block[], minutes: number, lang: string): Promise<Block[]> {
  const most = Math.max(1, Math.min(Math.floor(blocks.length / 5), 64 - blocks.length));
  const script = blocks.map((b, index) => ({ index, kind: b.kind, place: b.place ?? "", text: b.text ?? "", scene: b.scene ?? "" }));
  const prompt = await continuityPrompt(JSON.stringify(script), minutes, lang, most);

  let r: any;
  try {
    r = await ask(CONTINUITY_SYSTEM, prompt, Math.min(32000, 6000 + 500 * blocks.length));
  } catch {
    return blocks;
  }
  const out = blocks.map((b) => ({ ...b }));
  const str = (x: unknown): x is string => typeof x === "string" && x.trim() !== "";
  for (const e of r?.edits ?? []) {
    const i = e?.index;
    if (!Number.isInteger(i) || i < 0 || i >= out.length) continue;
    for (const k of ["text", "scene", "place"] as const) if (str(e[k])) out[i][k] = e[k];
  }
  const inserts = (r?.inserts ?? [])
    .filter((x: { after?: unknown; text?: unknown; scene?: unknown }) => Number.isInteger(x?.after) && (x.after as number) >= 0 && (x.after as number) < blocks.length && str(x.text) && str(x.scene))
    .slice(0, most)
    .sort((a: { after: number }, b: { after: number }) => b.after - a.after);
  for (const x of inserts)
    out.splice(x.after + 1, 0, {
      kind: "V",
      text: x.text,
      place: x.place ?? "",
      scene: x.scene,
      character_in_shot: x.character_in_shot !== false,
      action: x.action || "The character moves on through the scene.",
      camera: x.camera || "gentle drift",
      sound: x.sound || "soft ambience",
    } as Block);
  return out;
}

export const RESIZE_SYSTEM = "You edit narration lines. Return ONLY JSON.";

export function resizePrompt(text: string, seconds: string, want: string, language: string) {
  return `This talking line lasts ${seconds} s when spoken; it must last 6-12 s. Make it ${want}, keep the meaning, language ${language}. Line: "${text}"\nReturn {"text": "..."}`;
}

export async function resizeLine(text: string, seconds: number, lang: string): Promise<string> {
  const prompt = resizePrompt(text, seconds.toFixed(1), seconds > 12 ? "shorter" : "longer", await languageName(lang));
  return (await ask(RESIZE_SYSTEM, prompt, 2000)).text;
}

export const REPHRASE_SYSTEM = "You rewrite image prompts that were rejected by a safety filter. Return ONLY JSON.";

export function rephrasePrompt(scene: string) {
  return (
    "Rewrite this scene so it keeps the story meaning but avoids anything a strict filter could flag " +
    "(real names, brands, danger, weapons, crowds panicking). " +
    `Scene: "${scene}"\nReturn {"scene": "..."}`
  );
}

export async function rephraseScene(scene: string): Promise<string> {
  return (await ask(REPHRASE_SYSTEM, rephrasePrompt(scene), 2000)).scene;
}

async function see(system: string, prompt: string, imageUrls: string[]): Promise<any> {
  let last: unknown;
  for (let i = 0; i < 2; i++) {
    const r = await run<{ output?: string }>("openrouter/router/vision", {
      model: DIRECTOR_MODEL,
      system_prompt: system,
      prompt,
      image_urls: imageUrls,
      max_tokens: 6000,
      reasoning: true,
    });
    try {
      return parse(r.output || "");
    } catch (e) {
      last = e;
      prompt += "\n\nReturn ONLY the JSON object.";
    }
  }
  throw new Error(`vision director returned invalid JSON: ${last}`);
}

export type DescribedStyle = { label?: string; anchor: string; motion: string; character_hint?: string; palette: { bg: string; text: string; accent: string } };

export const STYLE_SYSTEM = "You are an art director. You describe illustration styles so an image model can reproduce them. Return ONLY JSON.";
export const STYLE_PROMPT =
    "Describe ONLY the art style of this image (medium, line quality, texture, lighting, palette, rendering), never its content. Return JSON: " +
    '{"label": "2-4 word style name", ' +
    '"anchor": "one sentence starting like \'<Style> film still: ...\' listing medium, linework, texture, lighting, palette, ending with \'widescreen 16:9 composition.\'", ' +
    '"motion": "one sentence describing how this style looks when animated", ' +
    '"character_hint": "what kind of narrator character fits this style world", ' +
    '"palette": {"bg": "#dark hex from the image", "text": "#light hex", "accent": "#accent hex"}}';

export async function describeStyle(imageUrl: string): Promise<DescribedStyle> {
  const d = await see(STYLE_SYSTEM, STYLE_PROMPT, [imageUrl]);
  d.palette ??= { bg: "#141414", text: "#f6f1e8", accent: "#f0a45a" };
  return d;
}

export const CHARACTER_SYSTEM = "You are a character designer writing a model-sheet description. Return ONLY JSON.";

export function characterDescribePrompt(name: string) {
  const given = name ? `The character's name is "${name}". ` : "Invent a short, memorable name that fits it. ";
  return (
    `${given}Describe the character in this image so an image model can redraw it identically in new scenes. ` +
    'Return JSON {"name": "...", "traits": "ONE comma-separated string of 6-9 concrete visual traits: body shape, colors, materials, ' +
    'face (eyes, mouth), clothing, props", "pronoun": "his|her|its"}. Mention the mouth. Do not mention the background or the art style.'
  );
}

export async function describeCharacter(imageUrl: string, name = ""): Promise<Given> {
  const d = await see(CHARACTER_SYSTEM, characterDescribePrompt(name), [imageUrl]);
  if (name) d.name = name;
  return d;
}

export async function translate(text: string, lang: string): Promise<string> {
  if (lang === "en") return text;
  const sys = "You translate short UI strings. Keep any {placeholder} exactly as written. Return ONLY JSON.";
  return (await ask(sys, `Translate into ${await languageName(lang)}: "${text}"\nReturn {"text": "..."}`, 1500)).text;
}
