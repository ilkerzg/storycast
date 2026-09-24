import type { CastMember, Language, Style } from "@/lib/api";

export type StyleFull = Style & { anchor: string; motion: string; character_hint: string; palette: { bg: string; text: string; accent: string }; ref: string };
export type CastFull = CastMember & { traits: string; pronoun: string; voice: CastMember["voice"] & { gender?: string; age?: string; accent?: string; description?: string } };
export type StudioData = {
  max_minutes: number;
  cameras: string[];
  categories: string[];
  styles: StyleFull[];
  character_groups: string[];
  characters: CastFull[];
  languages: (Language & { font: string })[];
  curated_voices: Record<string, string>;
};

let data: Promise<StudioData> | null = null;
export function studioData(): Promise<StudioData> {
  data ??= fetch("/data/config.json").then((r) => r.json());
  return data;
}

let cache: Promise<{ lines: Record<string, string>; samples: Record<string, string> }> | null = null;
export function seedCache() {
  cache ??= fetch("/data/cache.json").then((r) => r.json()).catch(() => ({ lines: {}, samples: {} }));
  return cache;
}

let films: Promise<any[]> | null = null;
export function seedFilms() {
  films ??= fetch("/data/films.json").then((r) => r.json()).catch(() => []);
  return films;
}

export async function languageName(code: string) {
  return (await studioData()).languages.find((l) => l.code === code)?.name ?? "English";
}
