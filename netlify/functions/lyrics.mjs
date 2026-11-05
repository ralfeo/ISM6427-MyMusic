import { json, checkAccess, callbackUrl, suno, relay } from "../lib/suno.mjs";

// POST /api/lyrics { prompt } — AI lyric writing (max 200 chars prompt).
export default async (req) => {
  if (req.method !== "POST") return json(405, { code: 405, msg: "Use POST" });
  const denied = checkAccess(req);
  if (denied) return denied;

  let input;
  try {
    input = await req.json();
  } catch {
    return json(400, { code: 400, msg: "Invalid JSON body" });
  }
  const prompt = typeof input.prompt === "string" ? input.prompt.trim().slice(0, 200) : "";
  if (!prompt) return json(400, { code: 400, msg: "Tell us what the lyrics should be about." });

  return relay(await suno("/api/v1/lyrics", { method: "POST", body: { prompt, callBackUrl: callbackUrl(req) } }));
};

export const config = { path: "/api/lyrics" };
