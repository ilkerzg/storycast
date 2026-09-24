import { ApiError, fal } from "@fal-ai/client";

const KEY = "storycast-fal-key";

function read(store: Storage | undefined): string {
  try {
    return store?.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function falKey(): string {
  return read(globalThis.sessionStorage) || read(globalThis.localStorage);
}

export function setFalKey(key: string, remember: boolean) {
  clearFalKey();
  try {
    (remember ? localStorage : sessionStorage).setItem(KEY, key.trim());
  } catch {}
  listeners.forEach((fn) => fn());
}

export function clearFalKey() {
  for (const store of [globalThis.sessionStorage, globalThis.localStorage]) {
    try {
      store?.removeItem(KEY);
    } catch {}
  }
  listeners.forEach((fn) => fn());
}

const listeners = new Set<() => void>();
export function onKeyChange(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function askForKey() {
  globalThis.dispatchEvent?.(new CustomEvent("storycast:need-key"));
}

export const looksLikeKey = (key: string) => /^[\w-]{8,}:[\w-]{8,}$/.test(key.trim());

export async function verifyKey(key: string): Promise<"ok" | "invalid" | "offline"> {
  try {
    const r = await fetch("https://queue.fal.run/fal-ai/ffmpeg-api/requests/00000000-0000-0000-0000-000000000000/status", {
      headers: { authorization: `Key ${key.trim()}` },
    });
    return r.status === 401 || r.status === 403 ? "invalid" : "ok";
  } catch {
    return "offline";
  }
}

fal.config({ credentials: () => falKey() || undefined, suppressLocalCredentialsWarning: true });

export class FalError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

export const isKeyError = (e: unknown) => e instanceof FalError && (e.status === 401 || e.status === 403);

class Semaphore {
  private queue: (() => void)[] = [];
  private active = 0;
  private limit: number;
  constructor(limit: number) {
    this.limit = limit;
  }
  async acquire() {
    if (this.active < this.limit) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active++;
  }
  release() {
    this.active--;
    this.queue.shift()?.();
  }
}
const sem = new Semaphore(6);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function describe(e: unknown): { message: string; status?: number } {
  if (e instanceof ApiError) {
    const body = e.body as { detail?: unknown } | undefined;
    const detail = body?.detail ?? body;
    return { message: typeof detail === "string" ? detail : JSON.stringify(detail ?? e.message), status: e.status };
  }
  return { message: e instanceof Error ? e.message : String(e) };
}

const RETRYABLE = new Set([429, 502, 503, 504]);
const offline = (e: unknown) => !(e instanceof ApiError);
const passing = (e: unknown) => offline(e) || RETRYABLE.has((e as ApiError<unknown>).status);

async function submit(app: string, input: Record<string, unknown>): Promise<string> {
  const r = await fetch(`https://queue.fal.run/${app}`, {
    method: "POST",
    headers: { authorization: `Key ${falKey()}`, "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = (await r.json().catch(() => ({}))) as { request_id?: string; detail?: unknown };
  if (!r.ok || !body.request_id) throw new ApiError({ message: `${app} answered ${r.status}`, status: r.status || 500, body, requestId: "" });
  return body.request_id;
}

async function follow<T>(app: string, requestId: string): Promise<T> {
  let misses = 0;
  for (;;) {
    try {
      const s = await fal.queue.status(app, { requestId });
      misses = 0;
      if (s.status === "COMPLETED") break;
    } catch (e) {
      if (!(passing(e) || (e instanceof ApiError && e.status >= 500)) || ++misses > 30) throw e;
    }
    await sleep(misses ? Math.min(15000, 1000 * 2 ** Math.min(misses, 4)) : 1500);
  }
  for (let i = 0; ; i++) {
    try {
      return (await fal.queue.result(app, { requestId })).data as T;
    } catch (e) {
      if (!passing(e) || i >= 8) throw e;
      await sleep(2000 * (i + 1));
    }
  }
}

export async function run<T = any>(app: string, input: Record<string, unknown>, retries = 1): Promise<T> {
  if (!falKey()) {
    askForKey();
    throw new FalError("Connect your fal key to make films", 401);
  }
  let last: { message: string; status?: number } = { message: "" };
  for (let attempt = 0; attempt <= retries; attempt++) {
    await sem.acquire();
    let submitted = false;
    let again = false;
    try {
      const requestId = await submit(app, input);
      submitted = true;
      return await follow<T>(app, requestId);
    } catch (e) {
      last = describe(e);
      if (last.status === 401 || last.status === 403) {
        askForKey();
        break;
      }
      again = submitted ? !passing(e) : !offline(e);
    } finally {
      sem.release();
    }
    if (!again) break;
    if (attempt < retries) await sleep(4000);
  }
  throw new FalError(`${app}: ${last.message.slice(0, 300)}`, last.status);
}

export async function duration(url: string): Promise<number> {
  const r = await run<{ media: { duration: number } }>("fal-ai/ffmpeg-api/metadata", { media_url: url });
  return Number(r.media.duration);
}

export function upload(file: File): Promise<string> {
  if (!falKey()) {
    askForKey();
    return Promise.reject(new FalError("Connect your fal key to upload images", 401));
  }
  return fal.storage.upload(file);
}
