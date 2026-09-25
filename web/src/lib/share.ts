import type { Film } from "@/lib/api";

export const SHARE_API =
  (import.meta.env.VITE_SHARE_API as string | undefined)?.replace(/\/$/, "") || "";
export const TURNSTILE_SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) || "";

export const SHARING = Boolean(SHARE_API);

export const REPO_URL = (import.meta.env.VITE_REPO_URL as string | undefined) || "https://github.com/ilkerzg/storycast";

export type Visibility = "unlisted" | "public";
export type ShareStatus = "unlisted" | "pending" | "public" | "hidden";
export type Owned = { id: string; owner: string; source: string; title: string; status: ShareStatus; shared: number; in_review?: boolean };
export type Quota = { links_left: number; links_reset_at: number | null; links_per_day: number; explore_left: number; busy: boolean };

const OWNED = "storycast-shared";

function readOwned(): Record<string, Owned> {
  try {
    return JSON.parse(localStorage.getItem(OWNED) || "{}");
  } catch {
    return {};
  }
}
function writeOwned(all: Record<string, Owned>) {
  try {
    localStorage.setItem(OWNED, JSON.stringify(all));
  } catch {}
}

export const owned = () => readOwned();

export const sharedCopy = (sourceId: string) => Object.values(readOwned()).find((o) => o.source === sourceId) ?? null;
export const ownedFilm = (sharedId: string) => readOwned()[sharedId] ?? null;

export class ShareError extends Error {
  code: string;
  status: number;
  data: Record<string, unknown>;
  constructor(message: string, status: number, data: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = String(data.code ?? "");
    this.data = data;
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`${SHARE_API}${path}`, { ...init, headers: { "content-type": "application/json", ...(init.headers || {}) } });
  const d = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) throw new ShareError(String(d.error || `sharing failed (${r.status})`), r.status, d);
  return d as T;
}

export const quota = () => call<Quota>("/api/quota");

export async function shareFilm(film: Film, visibility: Visibility, turnstile: string) {
  const body = {
    visibility,
    turnstile,
    film: {
      title: film.title,
      subtitle: film.subtitle,
      topic: film.topic,
      lang: film.lang,
      style: film.style,
      style_label: film.style_label,
      narrator: film.narrator,
      voice: film.voice,
      character_id: film.character_id,
      minutes: film.minutes,
      duration: film.duration,
      created: film.created,
      video: film.video,
      clean: film.clean,
      poster: film.poster,
      keyframes: film.keyframes,
      script: film.script,
      kinds: film.kinds,
      events: film.events,
    },
  };
  const r = await call<{ id: string; owner: string; status: ShareStatus; in_review: boolean; links_left: number }>("/api/share", { method: "POST", body: JSON.stringify(body) });
  const all = readOwned();
  all[r.id] = { id: r.id, owner: r.owner, source: film.id, title: `${film.title} ${film.subtitle}`.trim(), status: r.status, shared: Date.now() / 1000, in_review: r.in_review };
  writeOwned(all);
  return r;
}

export async function setVisibility(id: string, visibility: Visibility) {
  const o = readOwned()[id];
  if (!o) throw new Error("this browser did not share that film");
  const r = await call<{ status: ShareStatus }>(`/api/films/${id}`, { method: "PATCH", headers: { authorization: `Owner ${o.owner}` }, body: JSON.stringify({ visibility }) });
  const all = readOwned();
  all[id] = { ...o, status: r.status };
  writeOwned(all);
  return r.status;
}

export async function unshare(id: string) {
  const o = readOwned()[id];
  if (!o) throw new Error("this browser did not share that film");
  await call(`/api/films/${id}`, { method: "DELETE", headers: { authorization: `Owner ${o.owner}` } });
  const all = readOwned();
  delete all[id];
  writeOwned(all);
}

type Remote = Film & { status: ShareStatus; views: number; in_review?: boolean };

export const community = () => (SHARING ? call<{ films: Remote[] }>("/api/films").then((d) => d.films) : Promise.resolve([] as Remote[]));

export const sharedFilm = (id: string) => {
  const o = readOwned()[id];
  return call<{ film: Remote }>(`/api/films/${id}`, o ? { headers: { authorization: `Owner ${o.owner}` } } : {}).then((d) => d.film);
};
export const report = (id: string, reason: string) => call(`/api/films/${id}/report`, { method: "POST", body: JSON.stringify({ reason }) });
export const reportIssue = (film: Film, kind: string, note: string, at: number) =>
  call("/api/issues", { method: "POST", body: JSON.stringify({ film: film.id, title: `${film.title} ${film.subtitle}`.trim(), video: film.video, kind, note, at }) });
export const countView = (id: string) => call(`/api/films/${id}/view`, { method: "POST" }).catch(() => {});

export const isSharedId = (id: string) => SHARING && /^[A-Za-z0-9]{10}$/.test(id);

