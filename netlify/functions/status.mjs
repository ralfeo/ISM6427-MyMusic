import { json, checkAccess, suno, relay } from "../lib/suno.mjs";

// GET /api/status?taskId=...&type=music|lyrics
export default async (req) => {
  const denied = checkAccess(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const taskId = url.searchParams.get("taskId");
  if (!taskId || !/^[\w-]{1,128}$/.test(taskId)) return json(400, { code: 400, msg: "Missing or invalid taskId" });

  const path = url.searchParams.get("type") === "lyrics" ? "/api/v1/lyrics/record-info" : "/api/v1/generate/record-info";
  return relay(await suno(path, { query: { taskId } }));
};

export const config = { path: "/api/status" };
