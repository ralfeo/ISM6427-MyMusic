import { refreshFromSuno } from "../lib/songs.mjs";

// Suno POSTs here as a song progresses (text → first → complete). We don't
// trust the payload itself; we just use the task id to re-fetch the real
// status from Suno and update the shared library. This finishes songs even if
// the creator closed their browser tab.
export default async (req) => {
  try {
    const body = await req.json().catch(() => ({}));
    const taskId = String(body?.data?.task_id || body?.data?.taskId || body?.taskId || "");
    if (/^[\w-]{1,128}$/.test(taskId)) await refreshFromSuno(taskId);
  } catch (err) {
    console.error("callback error", err);
  }
  return new Response(JSON.stringify({ code: 200, msg: "received" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

export const config = { path: "/api/callback" };
