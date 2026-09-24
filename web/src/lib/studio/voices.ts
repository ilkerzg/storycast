import type { Voice, VoiceFacets, VoicePage, VoiceQuery } from "@/lib/api";
import { studioData, seedCache } from "./data";
import { translate } from "./director";
import { run } from "./fal";
import { cacheGet, cacheSet } from "./store";
import { SHARE_API } from "@/lib/share";

const TTS = "fal-ai/elevenlabs/tts/eleven-v3";
export const PREVIEW_LINE = "Hi! I'm your narrator. Sit back, and let me tell you a story you won't forget.";
export const TOPIC_LINE = "Hi, I'm your narrator. Today's story: {topic}.";

const EMPTY_FACETS: VoiceFacets = { total: 0, gender: [], age: [], accent: [], category: [], tags: [], languages: [] };

async function voiceApi<T>(path: string, params: Record<string, string>, signal?: AbortSignal): Promise<T> {
  const r = await fetch(`${SHARE_API}${path}?${new URLSearchParams(params)}`, { signal });
  if (!r.ok) throw new Error(`voices unavailable (${r.status})`);
  return r.json();
}

let facetCache: Promise<VoiceFacets> | null = null;
export function facets(): Promise<VoiceFacets> {
  if (!SHARE_API) return Promise.resolve(EMPTY_FACETS);
  facetCache ??= voiceApi<VoiceFacets>("/api/voices/facets", {}).catch((e) => {
    facetCache = null;
    throw e;
  });
  return facetCache;
}

export async function search(q: VoiceQuery, page = 0, signal?: AbortSignal): Promise<VoicePage> {
  if (!SHARE_API) return { voices: [], total_count: 0, has_more: false };
  return voiceApi<VoicePage>("/api/voices", { q: JSON.stringify(q), page: String(page) }, signal);
}

export type VoiceCheck = { voice: Voice | null; speaks: boolean; native: Voice | null };

export async function checkVoice(by: { id?: string; name?: string }, lang: string): Promise<VoiceCheck> {
  const none = { voice: null, speaks: true, native: null };
  if (!SHARE_API || !(by.id || by.name)) return none;
  const language = (await studioData()).languages.find((l) => l.code === lang)?.name ?? "English";
  return voiceApi<VoiceCheck>("/api/voices/check", { ...(by.id ? { id: by.id } : { name: by.name! }), lang, language }).catch(() => none);
}

export async function line(template: string, lang: string): Promise<string> {
  if (lang === "en") return template;
  const key = `${lang}|${template}`;
  const seeded = (await seedCache()).lines[key];
  const hit = cacheGet("lines", key) ?? seeded;
  if (hit) return hit;
  const t = await translate(template, lang);
  cacheSet("lines", key, t);
  return t;
}

async function sampleKey(voiceId: string, lang: string, text: string) {
  const bytes = new TextEncoder().encode(`${voiceId}|${lang}|${text}`);
  const hex = [...new Uint8Array(await crypto.subtle.digest("SHA-1", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex.slice(0, 16);
}

export async function sample(voiceId: string, text: string, lang = "en"): Promise<string> {
  const clean = Array.from(text.split(/\s+/).filter(Boolean).join(" ")).slice(0, 320).join("");
  const key = await sampleKey(voiceId, lang, clean);
  const hit = cacheGet("samples", key) ?? (await seedCache()).samples[key];
  if (hit) return hit;
  const r = await run<{ audio: { url: string } }>(TTS, { text: clean, voice: voiceId, stability: 0.5, language_code: lang });
  cacheSet("samples", key, r.audio.url);
  return r.audio.url;
}

export async function audition(voiceId: string, topic: string, lang: string) {
  const text = topic.trim() ? (await line(TOPIC_LINE, lang)).replace("{topic}", topic.trim().slice(0, 160)) : await line(PREVIEW_LINE, lang);
  return sample(voiceId, text, lang);
}

export async function characterIntro(characterId: string, lang: string) {
  const c = (await studioData()).characters.find((x) => x.id === characterId);
  if (!c) throw new Error("unknown character");
  const text = await line(`Hi, I'm ${c.name}! ${c.personality}.`, lang);
  return sample(c.voice.voice_id, text, lang);
}

export async function preview(v: Voice, lang: string) {
  const name = (await studioData()).languages.find((l) => l.code === lang)?.name ?? "English";
  const native = lang === "en" || (v.languages ?? []).includes(name.split(" ")[0].toLowerCase());
  if (v.preview_url && native) return v.preview_url;
  return sample(v.voice_id, await line(PREVIEW_LINE, lang), lang);
}
