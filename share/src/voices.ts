export type Voice = {
  voice_id: string;
  name: string;
  description: string;
  preview_url: string;
  category: string;
  tags: string[];
  languages?: string[];
  short?: string;
  gender: string;
  age: string;
  accent: string;
  collections: number;
  curated: boolean;
};

export type Query = {
  search: string;
  gender: string;
  age: string;
  accent: string;
  category: string;
  language: string;
  sort: string;
  curated: boolean;
  tags: string[];
};

const PAGE = 60;
const MAX_PAGES = 10;

let catalog: Promise<Voice[]> | null = null;

export function loadVoices(bucket: R2Bucket): Promise<Voice[]> {
  catalog ??= bucket
    .get("private/voices.json")
    .then((o) => (o ? (o.json() as Promise<Voice[]>) : []))
    .catch((e) => {
      catalog = null;
      throw e;
    });
  return catalog;
}

function rankCounts(xs: string[]): [string, number][] {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}
const rank = (xs: string[]) => rankCounts(xs).map(([k]) => k);

let facetCache: unknown = null;
export function listFacets(vs: Voice[]) {
  if (facetCache) return facetCache;
  const count = (key: "gender" | "age" | "accent" | "category") => rank(vs.map((v) => v[key]).filter(Boolean));
  facetCache = {
    total: vs.length,
    gender: count("gender"),
    age: count("age"),
    accent: count("accent").slice(0, 60),
    category: count("category"),
    tags: rankCounts(vs.flatMap((v) => v.tags ?? []))
      .slice(0, 160)
      .map(([tag, n]) => ({ tag, count: n })),
    languages: rankCounts(vs.flatMap((v) => v.languages ?? [])).map(([language, n]) => ({ language, count: n })),
  };
  return facetCache;
}

const text = (v: unknown, max = 80) => (typeof v === "string" ? v.slice(0, max) : "");

export function parseQuery(raw: string | null): Query {
  let q: Record<string, unknown> = {};
  try {
    q = JSON.parse(raw || "{}");
  } catch {
    q = {};
  }
  return {
    search: text(q.search, 120),
    gender: text(q.gender),
    age: text(q.age),
    accent: text(q.accent),
    category: text(q.category),
    language: text(q.language),
    sort: text(q.sort),
    curated: q.curated === true,
    tags: (Array.isArray(q.tags) ? q.tags : []).slice(0, 8).map((t) => text(t)),
  };
}

export function searchList(vs: Voice[], q: Query, page: number) {
  const needle = q.search.toLowerCase().trim();
  const want = new Set(q.tags);
  const hits = vs.filter((v) => {
    if (needle && !`${v.name} ${v.description} ${v.short ?? ""} ${(v.tags ?? []).join(" ")} ${v.accent ?? ""}`.toLowerCase().includes(needle)) return false;
    if ((["gender", "age", "accent", "category"] as const).some((k) => q[k] && v[k] !== q[k])) return false;
    if (q.language && !(v.languages ?? []).includes(q.language)) return false;
    if (want.size && ![...want].every((t) => (v.tags ?? []).includes(t))) return false;
    if (q.curated && !v.curated) return false;
    return true;
  });
  const byName = (a: Voice, b: Voice) => a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  if (q.sort === "name") hits.sort(byName);
  else if (q.sort === "popular" || !q.sort)
    hits.sort((a, b) => (b.collections ?? 0) - (a.collections ?? 0) || Number(a.curated === false) - Number(b.curated === false) || byName(a, b));
  else hits.sort((a, b) => Number(!a.curated) - Number(!b.curated) || (b.collections ?? 0) - (a.collections ?? 0));
  const p = Math.max(0, Math.min(MAX_PAGES - 1, Math.floor(page) || 0));
  return { voices: hits.slice(p * PAGE, (p + 1) * PAGE), total_count: hits.length, has_more: p + 1 < MAX_PAGES && (p + 1) * PAGE < hits.length };
}

function nativeLanguages(v: Voice): Set<string> {
  const out = new Set<string>();
  for (const x of v.languages ?? []) {
    if (x.endsWith("-accent")) continue;
    out.add(x);
    out.add(x.split("-").pop()!);
  }
  return out;
}

export function speaks(v: Voice, lang: string, languageName: string) {
  const langs = nativeLanguages(v);
  if (lang === "en") return langs.size === 0 || langs.has("english") || langs.size >= 10;
  return langs.has(languageName.split(" ")[0].toLowerCase());
}

export function nativeVoice(vs: Voice[], lang: string, languageName: string, like: Partial<Voice>) {
  const made = vs.filter((v) => speaks(v, lang, languageName));
  const cands = like.gender ? made.filter((v) => v.gender === like.gender) : made;
  const pool = cands.length ? cands : made;
  const fit = (v: Voice) => {
    const t = `${v.name} ${v.description} ${(v.tags ?? []).join(" ")}`.toLowerCase();
    let score = ["narrat", "story", "audiobook", "educat", "documentar", "warm", "friendly", "calm"].some((w) => t.includes(w)) ? 3 : 0;
    if (["seduc", "sexy", "customer", "support agent", "commercial", "advert", " ads", "asmr", "news"].some((w) => t.includes(w))) score -= 5;
    if (v.age && v.age === like.age) score += 2;
    return score + Math.log1p(v.collections ?? 0) / 3;
  };
  return [...pool].sort((a, b) => fit(b) - fit(a))[0] ?? null;
}
