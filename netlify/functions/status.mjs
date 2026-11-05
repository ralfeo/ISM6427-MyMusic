import { json, checkAccess, suno, relay } from "../lib/suno.mjs";
import { saveInfo } from "../lib/songs.mjs";

// GET /api/status?taskId=...&type=music|lyrics
export default async (req) => {
  const denied = checkAccess(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const taskId = url.searchParams.get("taskId");
  if (!taskId || !/^[\w-]{1,128}$/.test(taskId)) return json(400, { code: 400, msg: "Missing or invalid taskId" });

  const lyrics = url.searchParams.get("type") === "lyrics";
  const result = await suno(lyrics ? "/api/v1/lyrics/record-info" : "/api/v1/generate/record-info", { query: { taskId } });

  // Keep the shared library in sync with what the creator is seeing.
  if (!lyrics && Number(result?.code) === 200 && result.data) {
    await saveInfo(taskId, result.data).catch((err) => console.error("library update failed", err));
  }
  return relay(result);
};

export const config = { path: "/api/status" };
