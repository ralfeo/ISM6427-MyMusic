import { json, suno } from "../lib/suno.mjs";
import { store, clip, sha256, mergeInfo, isFinished, refreshFromSuno, publicView } from "../lib/songs.mjs";

const TASK_RE = /^[\w-]{1,128}$/;
const MAX_LIST = 200;

// GET    /api/songs                → shared library (open to everyone)
// POST   /api/songs {taskId,...}   → publish a song made before the shared library existed
// DELETE /api/songs {taskId,token} → creator (or APP_PASSWORD holder) removes a song
export default async (req) => {
  try {
    if (req.method === "GET") return await list();
    if (req.method === "POST") return await importSong(req);
    if (req.method === "DELETE") return await remove(req);
    return json(405, { code: 405, msg: "Method not allowed" });
  } catch (err) {
    console.error("songs error", err);
    return json(500, { code: 500, msg: "Song library is unavailable right now." });
  }
};

async function list() {
  const s = store();
  const { blobs } = await s.list();
  const records = (await Promise.all(blobs.map((b) => s.get(b.key, { type: "json" }).catch(() => null)))).filter(Boolean);

  // Finish off a few songs whose creator closed the tab before they were done.
  const stale = records
    .filter((r) => !isFinished(r) && Date.now() - r.createdAt < 24 * 60 * 60 * 1000 && Date.now() - (r.updatedAt || 0) > 20 * 1000)
    .slice(0, 4);
  await Promise.all(stale.map((r) => refreshFromSuno(r.taskId).then((u) => u && Object.assign(r, u)).catch(() => {})));

  const songs = records
    .filter((r) => r.tracks?.length && r.status !== "SENSITIVE_WORD_ERROR")
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_LIST)
    .map(publicView);
  return json(200, { code: 200, msg: "success", data: songs });
}

async function importSong(req) {
  const input = await req.json().catch(() => ({}));
  const taskId = String(input.taskId || "");
  if (!TASK_RE.test(taskId)) return json(400, { code: 400, msg: "Invalid taskId" });

  const s = store();
  const existing = await s.get(taskId, { type: "json" });
  if (existing) return json(200, { code: 200, msg: "exists", data: publicView(existing) });

  // Never trust the browser's copy: confirm with Suno that the task is real.
  const res = await suno("/api/v1/generate/record-info", { query: { taskId } });
  if (Number(res?.code) !== 200 || !res.data) return json(404, { code: 404, msg: "Song not found" });

  const token = crypto.randomUUID();
  const record = mergeInfo(
    {
      taskId,
      createdAt: Number(input.createdAt) > 0 && Number(input.createdAt) <= Date.now() ? Number(input.createdAt) : Date.now(),
      label: clip(input.label, 200),
      detail: clip(input.detail, 120),
      title: clip(input.title, 80),
      lyrics: "",
      style: clip(input.style, 300),
      status: "PENDING",
      tracks: [],
      ownerHash: await sha256(token),
    },
    res.data
  );
  if (!record.tracks.length) return json(404, { code: 404, msg: "Song has no audio" });
  await s.setJSON(taskId, record);
  return json(200, { code: 200, msg: "success", data: { ...publicView(record), ownerToken: token } });
}

async function remove(req) {
  const input = await req.json().catch(() => ({}));
  const taskId = String(input.taskId || "");
  if (!TASK_RE.test(taskId)) return json(400, { code: 400, msg: "Invalid taskId" });

  const s = store();
  const record = await s.get(taskId, { type: "json" });
  if (!record) return json(200, { code: 200, msg: "already gone" });

  const admin = process.env.APP_PASSWORD && req.headers.get("x-app-password") === process.env.APP_PASSWORD;
  const owner = input.token && record.ownerHash && (await sha256(String(input.token))) === record.ownerHash;
  if (!admin && !owner) return json(403, { code: 403, msg: "Only the person who made this song can remove it." });

  await s.delete(taskId);
  return json(200, { code: 200, msg: "deleted" });
}

export const config = { path: "/api/songs" };
