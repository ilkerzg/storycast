import { listFacets, loadVoices, nativeVoice, parseQuery, searchList, speaks } from "./voices";

export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  ALLOWED_ORIGINS: string;
  IP_SALT: string;
  TURNSTILE_SECRET?: string;
  FAL_KEY?: string;
  VOICE_LIMIT?: { limit(o: { key: string }): Promise<{ success: boolean }> };
}

type Status = "unlisted" | "pending" | "public" | "hidden";
type Media = { video: string; clean: string | null; poster: string | null; keyframes: string[] };
type Story = { script: string[]; kinds: string[]; events: { t: number; stage: string; msg: string }[] };
type Row = {
  id: string;
  owner_hash: string;
  status: Status;
  created: number;
  shared: number;
  title: string;
  subtitle: string;
  topic: string;
  lang: string;
  style: string;
  style_label: string;
  narrator: string;
  voice: string;
  character_id: string;
  minutes: number | null;
  duration: number;
  media: string;
  story: string;
  views: number;
  reports: number;
  link_at: number | null;
  flag: string;
  moderation: string;
};

const MB = 1024 * 1024;
const HOUR = 3600;
const DAY = 24 * HOUR;
const LINKS_PER_DAY = 10;
const EXPLORE_PER_DAY = 10;
const SHARES_PER_DAY_ALL = 500;
const REPORTS_TO_REVIEW = 3;
const ISSUES_PER_DAY = 20;
const ISSUE_KINDS = ["voice", "edit", "picture", "subtitles", "story", "other"];
const REFUSE_BELOW = 0.2;
const REVIEW_BELOW = 0.7;

class HttpError extends Error {
  status: number;
  extra: Record<string, unknown>;
  constructor(status: number, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const now = () => Math.floor(Date.now() / 1000);

function randomId(n: number) {
  const abc = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return [...bytes].map((b) => abc[b % abc.length]).join("");
}

async function sha256(text: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function same(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const ipHash = (req: Request, env: Env) => sha256(`${env.IP_SALT}|${req.headers.get("cf-connecting-ip") ?? ""}`);

function cors(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const allowed = env.ALLOWED_ORIGINS.split(",").map((s) => s.trim());
  if (!allowed.includes(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}

const json = (data: unknown, req: Request, env: Env, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...cors(req, env) } });

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function falUrl(v: unknown): string | null {
  if (typeof v !== "string" || !v) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" || !(u.hostname === "fal.media" || u.hostname.endsWith(".fal.media"))) return null;
    return u.toString();
  } catch {
    return null;
  }
}

const EXT_TYPES: Record<string, string> = { mp4: "video/mp4", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

const PART = 5 * MB;

async function putStream(env: Env, key: string, body: ReadableStream<Uint8Array>, type: string, maxBytes: number) {
  const meta = { httpMetadata: { contentType: type, cacheControl: "public, max-age=31536000, immutable" } };
  const reader = body.getReader();
  let buf = new Uint8Array(PART);
  let fill = 0;
  let total = 0;
  let upload: R2MultipartUpload | null = null;
  const parts: R2UploadedPart[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (value) {
        total += value.length;
        if (total > maxBytes) throw new HttpError(413, "the file is too large");
        let off = 0;
        while (off < value.length) {
          const n = Math.min(PART - fill, value.length - off);
          buf.set(value.subarray(off, off + n), fill);
          fill += n;
          off += n;
          if (fill === PART) {
            upload ??= await env.MEDIA.createMultipartUpload(key, meta);
            parts.push(await upload.uploadPart(parts.length + 1, buf));
            buf = new Uint8Array(PART);
            fill = 0;
          }
        }
      }
      if (done) break;
    }
    if (!total) throw new HttpError(422, "the file is empty");
    if (!upload) {
      await env.MEDIA.put(key, buf.subarray(0, fill), meta);
      return;
    }
    if (fill) parts.push(await upload.uploadPart(parts.length + 1, buf.subarray(0, fill)));
    await upload.complete(parts);
  } catch (e) {
    await upload?.abort().catch(() => {});
    await reader.cancel().catch(() => {});
    throw e;
  }
}

async function copy(env: Env, url: string, key: string, kind: "video" | "image", maxBytes: number) {
  const r = await fetch(url, { headers: { "accept-encoding": "identity" } });
  if (!r.ok || !r.body) throw new HttpError(422, `could not read the ${kind} from fal (${r.status})`);
  const ext = new URL(url).pathname.split(".").pop()?.toLowerCase() ?? "";

  const ALLOWED = kind === "video" ? ["video/mp4"] : ["image/png", "image/jpeg", "image/webp"];
  let type = (r.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!ALLOWED.includes(type)) type = EXT_TYPES[ext] ?? "";
  if (!ALLOWED.includes(type)) throw new HttpError(422, `that ${kind} is not a supported ${kind} file`);

  let length = Number(r.headers.get("content-length"));
  if (!length) length = Number((await fetch(url, { method: "HEAD", headers: { "accept-encoding": "identity" } })).headers.get("content-length"));
  if (length > maxBytes) throw new HttpError(413, `the ${kind} is too large`);
  const name = `${key}.${type === "video/mp4" ? "mp4" : (Object.entries(EXT_TYPES).find(([, t]) => t === type)?.[0] ?? "bin")}`;
  if (length > 0) {
    const body = r.headers.get("content-length") ? r.body : r.body.pipeThrough(new FixedLengthStream(length));
    await env.MEDIA.put(name, body, { httpMetadata: { contentType: type, cacheControl: "public, max-age=31536000, immutable" } });
  } else await putStream(env, name, r.body, type, maxBytes);
  return name;
}

async function pool<T, R>(items: T[], limit: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

async function falRun<T>(env: Env, app: string, input: Record<string, unknown>): Promise<T> {
  const r = await fetch(`https://fal.run/${app}`, {
    method: "POST",
    headers: { authorization: `Key ${env.FAL_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) throw new Error(`${app} answered ${r.status}`);
  return (await r.json()) as T;
}

const DESCRIBE =
  "You are a content safety describer. Describe factually and briefly what the images show. Always mention any nudity or sexual " +
  "content, violence, blood or gore, weapons, drugs, hate symbols, real recognisable people or celebrities, brand logos, visible text, " +
  "URLs or QR codes. Do not judge, only describe.";

const QUESTIONS = {
  allowed: {
    type: "noul",
    instructions: "Is this shared story fine to show publicly on a family-friendly site of short narrated explainer films?",
    criteria: {
      true: "Harmless storytelling or explanation on any topic, including history, science, nature and everyday life.",
      false:
        "Sexual content, hate or harassment, graphic violence or gore, self-harm, illegal activity, spam or ads, scams or phishing, " +
        "personal data, a video that does not match the story, or content that is not a story at all.",
    },
  },
  category: {
    type: "choice",
    instructions: "What is the main problem, if any?",
    criteria: {
      none: "No problem",
      sexual: "Sexual or adult content",
      hate: "Hate, harassment or bullying",
      violence: "Graphic violence or gore",
      illegal: "Illegal activity, drugs or weapons",
      spam: "Spam, ads, links, scams or phishing",
      personal: "Personal data about real private people",
      mismatch: "The video does not match the story",
      other: "Something else unsafe",
    },
  },
};

type Verdict = { allowed: number | null; category: string; seen: string };

async function moderate(env: Env, video: string, images: string[], text: Record<string, unknown>): Promise<Verdict> {
  if (!env.FAL_KEY) return { allowed: null, category: "unchecked", seen: "" };
  try {
    const frames = await Promise.all(
      ["first", "middle", "last"].map((frame_type) =>
        falRun<{ images?: { url: string }[] }>(env, "fal-ai/ffmpeg-api/extract-frame", { video_url: video, frame_type })
          .then((r) => r.images?.[0]?.url ?? null)
          .catch(() => null),
      ),
    );
    const got = frames.filter((u): u is string => !!u);
    if (!got.length) return { allowed: null, category: "unreadable", seen: "" };
    const vision = await falRun<{ output: string }>(env, "openrouter/router/vision", {
      model: "google/gemini-3.8-flash",
      reasoning: true,
      temperature: 0,
      max_tokens: 1500,
      system_prompt: DESCRIBE,
      prompt: "The first images are frames from one short video, the rest are illustrations shown with it. Describe them in at most 120 words.",
      image_urls: [...got, ...images.slice(0, 3)],
    });
    const seen = String(vision.output ?? "").slice(0, 2000);
    const d = await falRun<{ answers: { allowed?: { noul: number }; category?: { choice: string } } }>(env, "openrouter/router/decisions", {
      state: JSON.stringify({ ...text, what_the_video_shows: seen }),
      questions: QUESTIONS,
    });
    return { allowed: d.answers.allowed?.noul ?? null, category: d.answers.category?.choice ?? "none", seen };
  } catch {
    return { allowed: null, category: "unchecked", seen: "" };
  }
}

async function verifyTurnstile(env: Env, token: unknown, req: Request) {
  if (!env.TURNSTILE_SECRET) return;
  if (typeof token !== "string" || !token) throw new HttpError(403, "the bot check is missing, please try again");
  const form = new FormData();
  form.set("secret", env.TURNSTILE_SECRET);
  form.set("response", token);
  form.set("remoteip", req.headers.get("cf-connecting-ip") ?? "");
  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
  const d = (await r.json()) as { success?: boolean; hostname?: string };
  if (!d.success) throw new HttpError(403, "the bot check failed, please try again");

  const origins = env.ALLOWED_ORIGINS.split(",").map((o) => new URL(o.trim()).hostname);
  if (d.hostname && !origins.includes(d.hostname)) throw new HttpError(403, "the bot check failed, please try again");
}

const sigHash = async (env: Env, id: string, exp: number) => (await sha256(`${env.IP_SALT}|media|${id}|${exp}`)).slice(0, 24);

async function mediaSig(env: Env, id: string) {
  const exp = (Math.floor(now() / HOUR) + 2) * HOUR;
  return `${exp}.${await sigHash(env, id, exp)}`;
}
async function validSig(env: Env, id: string, sig: string | null) {
  const [exp, hash] = (sig ?? "").split(".");
  const e = Number(exp);
  return Number.isFinite(e) && e > now() && e - now() <= 2 * HOUR && same(hash ?? "", await sigHash(env, id, e));
}

function mediaUrl(req: Request, key: string | null, sig = "") {
  return key ? `${new URL(req.url).origin}/m/${key}${sig ? `?s=${sig}` : ""}` : null;
}

function toFilm(req: Request, row: Row, full: boolean, sig = "") {
  const m = JSON.parse(row.media) as Media;
  const s = JSON.parse(row.story) as Story;
  const poster = mediaUrl(req, m.poster, sig);
  return {
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    topic: row.topic,
    style: row.style,
    style_label: row.style_label,
    lang: row.lang,
    minutes: row.minutes,
    duration: row.duration,
    created: row.shared,
    narrator: row.narrator,
    voice: row.voice,
    video: mediaUrl(req, m.video, sig),
    clean: mediaUrl(req, m.clean, sig),
    poster,
    thumb: poster,
    keyframes: m.keyframes.map((k) => mediaUrl(req, k, sig)),
    script: s.script,
    kinds: s.kinds,
    character_id: row.character_id,
    events: full ? s.events : [],
    community: true,
    status: row.status,
    in_review: row.status === "hidden" && !!row.flag,
    views: row.views,
  };
}

async function quota(env: Env, ip: string) {
  const t = now();
  const q = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM films WHERE link_ip = ?1 AND link_at > ?2) AS links,
       (SELECT MIN(link_at) FROM films WHERE link_ip = ?1 AND link_at > ?2) AS oldest,
       (SELECT COUNT(*) FROM films WHERE ip_hash = ?1 AND shared > ?2 AND link_at IS NULL) AS explore,
       (SELECT COUNT(*) FROM films WHERE shared > ?2) AS everyone`,
  )
    .bind(ip, t - DAY)
    .first<{ links: number; oldest: number | null; explore: number; everyone: number }>();
  return {
    links_left: Math.max(0, LINKS_PER_DAY - (q?.links ?? 0)),
    links_reset_at: q?.oldest ? q.oldest + DAY : null,
    explore_left: Math.max(0, EXPLORE_PER_DAY - (q?.explore ?? 0)),
    busy: (q?.everyone ?? 0) >= SHARES_PER_DAY_ALL,
  };
}

function linkLimit(q: Awaited<ReturnType<typeof quota>>) {
  return new HttpError(429, `you have shared ${LINKS_PER_DAY} links today`, { code: "link_limit", reset_at: q.links_reset_at, limit: LINKS_PER_DAY });
}

async function getRow(env: Env, id: string) {
  return env.DB.prepare("SELECT * FROM films WHERE id = ?").bind(id).first<Row>();
}

async function ownerOf(req: Request, env: Env, id: string) {
  const row = await getRow(env, id);
  if (!row) throw new HttpError(404, "film not found");
  const token = (req.headers.get("authorization") ?? "").replace(/^Owner\s+/i, "");
  if (!token || !same(await sha256(token), row.owner_hash)) throw new HttpError(403, "this browser did not share that film");
  return row;
}

async function removeFilm(env: Env, id: string) {
  const listed = await env.MEDIA.list({ prefix: `media/${id}/` });
  if (listed.objects.length) await env.MEDIA.delete(listed.objects.map((o) => o.key));
  await env.DB.batch([env.DB.prepare("DELETE FROM films WHERE id = ?").bind(id), env.DB.prepare("DELETE FROM reports WHERE film_id = ?").bind(id)]);
}

async function share(req: Request, env: Env) {
  const body = (await req.json().catch(() => null)) as { film?: Record<string, unknown>; visibility?: string; turnstile?: string } | null;
  const f = body?.film;
  if (!f) throw new HttpError(400, "no film in the request");
  await verifyTurnstile(env, body?.turnstile, req);

  const ip = await ipHash(req, env);
  const t = now();
  const wantsLink = body?.visibility !== "public";
  const q = await quota(env, ip);
  if (q.busy) throw new HttpError(429, "Storycast has had a lot of shares today, please try again tomorrow", { code: "busy" });
  if (wantsLink && q.links_left <= 0) throw linkLimit(q);
  if (!wantsLink && q.explore_left <= 0) throw new HttpError(429, "you have sent a lot of stories to Explore today", { code: "explore_limit" });

  const video = falUrl(f.video);
  if (!video) throw new HttpError(400, "the film's video must be a fal media URL");
  const clean = falUrl(f.clean);
  const keyframeUrls = (Array.isArray(f.keyframes) ? f.keyframes : []).map(falUrl).filter((u): u is string => !!u).slice(0, 24);
  const posterUrl = falUrl(f.poster) ?? keyframeUrls[0] ?? null;
  const title = str(f.title, 160).trim();
  if (!title) throw new HttpError(400, "the film has no title");

  const id = randomId(10);
  const base = `media/${id}`;
  const lines = (Array.isArray(f.script) ? f.script : []).slice(0, 200).map((x) => str(x, 2000));
  let media: Media;
  let verdict: Verdict;
  try {
    const check = moderate(env, video, [posterUrl, ...keyframeUrls].filter((u): u is string => !!u), {
      title,
      subtitle: str(f.subtitle, 200),
      topic: str(f.topic, 600),
      narrator: str(f.narrator, 80),
      script: lines.join("\n").slice(0, 6000),
    });

    const videos = async () => {
      const film = await copy(env, video, `${base}/film`, "video", 160 * MB);
      return [film, clean ? await copy(env, clean, `${base}/clean`, "video", 160 * MB) : null] as const;
    };
    const [[v, c], p, k] = await Promise.all([
      videos(),
      posterUrl ? copy(env, posterUrl, `${base}/poster`, "image", 12 * MB) : Promise.resolve(null),
      pool(keyframeUrls, 3, (u, i) => copy(env, u, `${base}/kf-${String(i).padStart(2, "0")}`, "image", 12 * MB)),
    ]);
    media = { video: v, clean: c, poster: p, keyframes: k };
    verdict = await check;
  } catch (e) {
    await removeFilm(env, id).catch(() => {});
    throw e;
  }
  if (verdict.allowed !== null && verdict.allowed < REFUSE_BELOW) {
    await removeFilm(env, id).catch(() => {});
    throw new HttpError(422, "This story can't be shared on Storycast: it did not pass the safety check.", { code: "refused", reason: verdict.category });
  }

  const review = verdict.allowed === null || verdict.allowed < REVIEW_BELOW;
  const story: Story = {
    script: lines,
    kinds: (Array.isArray(f.kinds) ? f.kinds : []).slice(0, lines.length).map((k) => (k === "T" ? "T" : "V")),
    events: (Array.isArray(f.events) ? f.events : []).slice(0, 60).map((e) => {
      const ev = (e ?? {}) as Record<string, unknown>;
      return { t: num(ev.t), stage: str(ev.stage, 24), msg: str(ev.msg, 300) };
    }),
  };
  const owner = randomId(32);
  const status: Status = review ? "hidden" : wantsLink ? "unlisted" : "pending";
  const linked = wantsLink && !review;
  await env.DB.prepare(
    `INSERT INTO films (id, owner_hash, status, created, shared, title, subtitle, topic, lang, style, style_label, narrator, voice,
       character_id, minutes, duration, media, story, ip_hash, link_at, link_ip, flag, moderation, wants)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      id,
      await sha256(owner),
      status,
      Math.floor(num(f.created)) || t,
      t,
      title,
      str(f.subtitle, 200),
      str(f.topic, 600),
      str(f.lang, 12) || "en",
      str(f.style, 60),
      str(f.style_label, 80),
      str(f.narrator, 80),
      str(f.voice, 120),
      str(f.character_id, 60),
      num(f.minutes) || null,
      num(f.duration),
      JSON.stringify(media),
      JSON.stringify(story),
      ip,
      linked ? t : null,
      linked ? ip : "",
      review ? verdict.category || "unsure" : "",
      JSON.stringify(verdict),
      wantsLink ? "unlisted" : "public",
    )
    .run();
  const left = await quota(env, ip);
  return json({ id, owner, status, in_review: review, links_left: left.links_left }, req, env, 201);
}

async function report(req: Request, env: Env, id: string) {
  const row = await getRow(env, id);
  if (!row || row.status === "hidden") throw new HttpError(404, "film not found");
  const body = (await req.json().catch(() => ({}))) as { reason?: string };
  const ip = await ipHash(req, env);
  const added = await env.DB.prepare("INSERT OR IGNORE INTO reports (film_id, ip_hash, reason, created) VALUES (?,?,?,?)")
    .bind(id, ip, str(body.reason, 500), now())
    .run();
  if (added.meta.changes) {
    await env.DB.prepare(
      "UPDATE films SET reports = reports + 1, status = CASE WHEN status = 'public' AND reports + 1 >= ? THEN 'pending' ELSE status END WHERE id = ?",
    )
      .bind(REPORTS_TO_REVIEW, id)
      .run();
  }
  return json({ ok: true }, req, env);
}

async function issue(req: Request, env: Env) {
  if (!Object.keys(cors(req, env)).length) throw new HttpError(403, "not allowed");
  const body = (await req.json().catch(() => ({}))) as { film?: unknown; kind?: unknown; note?: unknown; at?: unknown; title?: unknown; video?: unknown };
  const film = str(body.film, 16);
  const kind = str(body.kind, 16);
  if (!/^[A-Za-z0-9]{8,10}$/.test(film) || !ISSUE_KINDS.includes(kind)) throw new HttpError(400, "bad report");
  const at = num(body.at);
  const own = typeof body.video === "string" && body.video.startsWith(new URL(req.url).origin + "/m/") ? body.video.slice(0, 300) : "";
  const video = falUrl(body.video) ?? own;
  const ip = await ipHash(req, env);
  const t = now();
  const added = await env.DB.prepare(
    "INSERT INTO issues (film_id, kind, note, title, video, at, ip_hash, created) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM issues WHERE ip_hash = ? AND created > ?) < ?",
  )
    .bind(film, kind, str(body.note, 1000).trim(), str(body.title, 200), video, at > 0 ? Math.round(at * 10) / 10 : null, ip, t, ip, t - DAY, ISSUES_PER_DAY)
    .run();
  if (!added.meta.changes) throw new HttpError(429, "you have sent a lot of reports today");
  return json({ ok: true }, req, env, 201);
}

const statusCache = new Map<string, { status: Status | null; at: number }>();
async function filmStatus(env: Env, id: string) {
  const hit = statusCache.get(id);
  if (hit && Date.now() - hit.at < 30_000) return hit.status;
  const row = await env.DB.prepare("SELECT status FROM films WHERE id = ?").bind(id).first<{ status: Status }>();
  statusCache.set(id, { status: row?.status ?? null, at: Date.now() });
  if (statusCache.size > 5000) statusCache.clear();
  return row?.status ?? null;
}

async function serveMedia(req: Request, env: Env, ctx: ExecutionContext, key: string) {
  const id = key.split("/")[1];
  const status = await filmStatus(env, id);
  if (!status) return new Response("not found", { status: 404 });

  if (status !== "public" && status !== "unlisted" && !(await validSig(env, id, new URL(req.url).searchParams.get("s"))))
    return new Response("not found", { status: 404 });
  const cache = caches.default;
  const cacheKey = new URL(req.url).toString();
  if (req.method === "GET") {
    const range = req.headers.get("range");
    const hit = await cache.match(new Request(cacheKey, { headers: range ? { range } : {} }));
    if (hit) {
      const res = new Response(hit.body, hit);
      res.headers.set("access-control-allow-origin", "*");
      return res;
    }
  }
  const obj = await env.MEDIA.get(key, { range: req.headers, onlyIf: req.headers });
  if (!obj) return new Response("not found", { status: 404 });
  const headers = new Headers({ "access-control-allow-origin": "*", "accept-ranges": "bytes", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox" });
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  if (!("body" in obj)) return new Response(null, { status: 304, headers });
  if (req.method === "GET" && obj.size <= 200 * MB) {
    ctx.waitUntil(
      (async () => {
        const full = await env.MEDIA.get(key);
        if (!full) return;
        const h = new Headers({ "accept-ranges": "bytes", "content-length": String(full.size), "cache-control": "public, max-age=604800" });
        full.writeHttpMetadata(h);
        h.set("cache-control", "public, max-age=604800");
        h.set("etag", full.httpEtag);
        await cache.put(cacheKey, new Response(full.body, { headers: h }));
      })().catch(() => {}),
    );
  }
  const range = obj.range as { offset?: number; length?: number; suffix?: number } | undefined;
  if (range && req.headers.has("range")) {
    const offset = range.suffix !== undefined ? obj.size - range.suffix : (range.offset ?? 0);
    const length = range.suffix !== undefined ? range.suffix : (range.length ?? obj.size - offset);
    headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${obj.size}`);
    headers.set("content-length", String(length));
    return new Response(req.method === "HEAD" ? null : obj.body, { status: 206, headers });
  }
  headers.set("content-length", String(obj.size));
  return new Response(req.method === "HEAD" ? null : obj.body, { headers });
}

async function voices(req: Request, env: Env, path: string) {
  if (!Object.keys(cors(req, env)).length) throw new HttpError(403, "not allowed");
  const ip = await ipHash(req, env);
  if (env.VOICE_LIMIT && !(await env.VOICE_LIMIT.limit({ key: ip })).success) throw new HttpError(429, "too many requests, slow down");
  const url = new URL(req.url);
  const send = (data: unknown) => {
    const r = json(data, req, env);
    r.headers.set("cache-control", "private, max-age=300");
    return r;
  };
  const list = await loadVoices(env.MEDIA);
  if (path === "/api/voices") {
    const q = parseQuery(url.searchParams.get("q"));
    const page = Number(url.searchParams.get("page"));
    return send(searchList(list, q, page));
  }
  if (path === "/api/voices/facets") return send(listFacets(list));
  if (path === "/api/voices/check") {
    const id = str(url.searchParams.get("id"), 64);
    const name = str(url.searchParams.get("name"), 200);
    const lang = str(url.searchParams.get("lang"), 12) || "en";
    const language = str(url.searchParams.get("language"), 60) || "English";
    const voice = list.find((v) => (id ? v.voice_id === id : v.name === name)) ?? null;
    const ok = voice ? speaks(voice, lang, language) : true;
    const native = voice && !ok ? nativeVoice(list, lang, language, voice) : null;
    return send({ voice, speaks: ok, native });
  }
  throw new HttpError(404, "not found");
}

async function route(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const m = req.method;

  if (m === "OPTIONS") return new Response(null, { status: 204, headers: cors(req, env) });
  if ((m === "GET" || m === "HEAD") && path.startsWith("/m/media/")) return serveMedia(req, env, ctx, decodeURIComponent(path.slice(3)));

  if (path === "/api/share" && m === "POST") return share(req, env);
  if (path === "/api/issues" && m === "POST") return issue(req, env);
  if (path.startsWith("/api/voices") && m === "GET") return voices(req, env, path);
  if (path === "/api/quota" && m === "GET") {
    const q = await quota(env, await ipHash(req, env));
    return json({ ...q, links_per_day: LINKS_PER_DAY }, req, env);
  }

  if (path === "/api/films" && m === "GET") {
    const rows = await env.DB.prepare("SELECT * FROM films WHERE status = 'public' ORDER BY shared DESC LIMIT 500").all<Row>();
    return json({ films: rows.results.map((r) => toFilm(req, r, false)) }, req, env);
  }

  const film = path.match(/^\/api\/films\/([A-Za-z0-9]{10})(\/report|\/view)?$/);
  if (film) {
    const [, id, action] = film;
    if (action === "/report" && m === "POST") return report(req, env, id);
    if (action === "/view" && m === "POST") {
      await env.DB.prepare("UPDATE films SET views = views + 1 WHERE id = ? AND status != 'hidden'").bind(id).run();
      return json({ ok: true }, req, env);
    }
    if (!action && m === "GET") {
      const row = await getRow(env, id);
      if (!row) throw new HttpError(404, "film not found");
      if (row.status === "public" || row.status === "unlisted") return json({ film: toFilm(req, row, true) }, req, env);

      const token = (req.headers.get("authorization") ?? "").replace(/^Owner\s+/i, "");
      if (token && same(await sha256(token), row.owner_hash)) return json({ film: toFilm(req, row, true, await mediaSig(env, id)) }, req, env);
      if (row.status === "pending" || row.flag) throw new HttpError(403, "this story is waiting for review", { code: "in_review" });
      throw new HttpError(404, "film not found");
    }
    if (!action && m === "PATCH") {
      const row = await ownerOf(req, env, id);
      const body = (await req.json().catch(() => ({}))) as { visibility?: string };
      if (row.status === "hidden") throw new HttpError(403, row.flag ? "this story is waiting for a manual review" : "this film was taken down");
      if (body.visibility === "public") {
        const status: Status = row.status === "public" ? "public" : "pending";
        await env.DB.prepare("UPDATE films SET status = ? WHERE id = ?").bind(status, id).run();
        return json({ id, status }, req, env);
      }

      if (row.link_at === null) {
        const ip = await ipHash(req, env);
        const q = await quota(env, ip);
        if (q.links_left <= 0) throw linkLimit(q);
        await env.DB.prepare("UPDATE films SET status = 'unlisted', link_at = ?, link_ip = ? WHERE id = ?").bind(now(), ip, id).run();
      } else await env.DB.prepare("UPDATE films SET status = 'unlisted' WHERE id = ?").bind(id).run();
      return json({ id, status: "unlisted" }, req, env);
    }
    if (!action && m === "DELETE") {
      await ownerOf(req, env, id);
      await removeFilm(env, id);
      return json({ ok: true }, req, env);
    }
  }

  if (path === "/" && m === "GET") return new Response("Storycast sharing API", { headers: { "content-type": "text/plain" } });
  throw new HttpError(404, "not found");
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      return await route(req, env, ctx);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message, ...e.extra }, req, env, e.status);
      console.error(e);
      return json({ error: "something went wrong" }, req, env, 500);
    }
  },
} satisfies ExportedHandler<Env>;
