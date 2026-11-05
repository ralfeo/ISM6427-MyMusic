// Shared song library stored in Netlify Blobs, so every visitor sees the
// same songs (not just the browser that created them).
import { getStore } from "@netlify/blobs";
import { suno } from "./suno.mjs";

const FAILED = new Set(["CREATE_TASK_FAILED", "GENERATE_AUDIO_FAILED", "SENSITIVE_WORD_ERROR", "CALLBACK_EXCEPTION"]);

export const store = () => getStore({ name: "songs", consistency: "strong" });

export const clip = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");

export async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const safeUrl = (u) => (typeof u === "string" && /^https:\/\//i.test(u) ? u : "");

export function extractTracks(info) {
  const list = info?.response?.sunoData || info?.response?.data || [];
  return list
    .filter((t) => t && t.id)
    .map((t) => ({
      id: String(t.id),
      title: clip(t.title, 120),
      tags: clip(t.tags, 300),
      image: safeUrl(t.image_url || t.imageUrl),
      audio: safeUrl(t.audio_url || t.audioUrl),
      stream: safeUrl(t.stream_audio_url || t.streamAudioUrl),
      duration: Number(t.duration) || 0,
      lyrics: clip(t.prompt || t.lyrics || "", 6000),
    }))
    .filter((t) => t.audio || t.stream);
}

// Merge a fresh Suno record-info response into a stored song. Suno often
// leaves the 2nd take's title/lyrics blank, and later polls can blank fields
// an earlier poll had, so never overwrite known values with empty ones.
export function mergeInfo(record, info) {
  const prev = new Map((record.tracks || []).map((t) => [t.id, t]));
  const fresh = extractTracks(info).map((t) => {
    const out = { ...(prev.get(t.id) || {}) };
    for (const [k, v] of Object.entries(t)) if (v) out[k] = v;
    return out;
  });
  if (fresh.length) record.tracks = fresh;
  const title = record.tracks?.map((t) => t.title).find(Boolean) || record.title || "";
  const lyrics = record.tracks?.map((t) => t.lyrics).find(Boolean) || record.lyrics || "";
  const tags = record.tracks?.map((t) => t.tags).find(Boolean) || record.style || "";
  record.tracks = (record.tracks || []).map((t) => ({
    ...t,
    title: t.title || title,
    lyrics: t.lyrics || lyrics,
    tags: t.tags || tags,
  }));

  const status = info?.status || record.status;
  const allDone = record.tracks.length > 0 && record.tracks.every((t) => t.audio);
  record.status = status === "CALLBACK_EXCEPTION" && allDone ? "SUCCESS" : status;
  record.updatedAt = Date.now();
  return record;
}

export const isFinished = (r) => r.status === "SUCCESS" || FAILED.has(r.status);

// Pull the latest state for a task from Suno and save it. Returns the record.
export async function refreshFromSuno(taskId, seed) {
  const s = store();
  const record = (await s.get(taskId, { type: "json" })) || seed;
  if (!record) return null;
  const res = await suno("/api/v1/generate/record-info", { query: { taskId } });
  if (Number(res?.code) !== 200) return record;
  mergeInfo(record, res.data);
  await s.setJSON(taskId, record);
  return record;
}

// Update a stored song (if we have one) from an already-fetched Suno response.
export async function saveInfo(taskId, info) {
  const s = store();
  const record = await s.get(taskId, { type: "json" });
  if (!record) return;
  mergeInfo(record, info);
  await s.setJSON(taskId, record);
}

export function publicView(r) {
  const { ownerHash, ...rest } = r;
  return rest;
}
