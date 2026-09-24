import { shape, words } from "./director";

const PRICE = {
  video: 0.08,
  image: 0.045,
  voice: 0.0001,
  music: 0.6,
  separate: 0.05 / 30,
  check: 0.03,
};
const WORDS_PER_SECOND = 2.25;
const CHARS_PER_SECOND = 15;

export type CostEstimate = { total: number; video: number; images: number; sound: number; direction: number; seconds: number };

export function estimateCost(minutes: number, invent = false): CostEstimate {
  const [n, t] = shape(minutes);
  const v = n - t;
  const [vSpeech, tSpeech] = words(minutes).map((r) => {
    const [a, b] = r.split("-").map(Number);
    return (a + b) / 2 / WORDS_PER_SECOND;
  });
  const vShot = Math.min(15, Math.ceil(vSpeech + 0.35) + 1);
  const r2v = v * vShot + 9;
  const lipsync = t * tSpeech;
  const seconds = 1.5 + v * (vSpeech + 0.35) + t * (tSpeech + 0.35) + 8 + 4;
  const video = (r2v + lipsync) * PRICE.video;
  const images = (n + 2 + (invent ? 2 : 0)) * PRICE.image;
  const sound = (v * vSpeech + t * tSpeech) * CHARS_PER_SECOND * PRICE.voice + (Math.max(30, seconds + 3) / 60) * PRICE.music;
  const direction = 0.3 + 0.15 * minutes + r2v * PRICE.separate + (v + 1) * PRICE.check + 0.05 * minutes;
  return { total: video + images + sound + direction, video, images, sound, direction, seconds };
}

export function dollars(x: number) {
  const r = Math.round(x * 2) / 2;
  return r % 1 ? `$${r.toFixed(2)}` : `$${r}`;
}
