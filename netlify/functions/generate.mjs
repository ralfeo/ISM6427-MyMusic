import { json, checkAccess, callbackUrl, suno, relay } from "../lib/suno.mjs";
import { store, sha256 } from "../lib/songs.mjs";

const MODELS = new Set(["V6", "V6_WILD", "V6_MINI"]);
const clip = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const num = (v, lo, hi) => {
  const n = Number(v);
  return Number.isFinite(n) && v !== "" && v !== null ? Math.min(hi, Math.max(lo, n)) : undefined;
};

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

  const customMode = Boolean(input.customMode);
  const instrumental = Boolean(input.instrumental);
  const model = MODELS.has(input.model) ? input.model : "V6";

  const body = { customMode, instrumental, model, callBackUrl: callbackUrl(req) };

  if (!customMode) {
    // Simple mode: describe the song, Suno writes the lyrics.
    const prompt = clip(input.prompt, 3000);
    const style = clip(input.style, 1000);
    if (!prompt && !style) return json(400, { code: 400, msg: "Describe the song you want." });
    if (prompt) body.prompt = prompt;
    if (style) body.style = style;
  } else {
    // Custom mode: you control title, style and exact lyrics.
    const style = clip(input.style, 1000);
    const lyrics = clip(input.lyrics, 5000);
    const negativeTags = clip(input.negativeTags, 1000);
    const title = clip(input.title, 80);
    if (!style && !lyrics && !negativeTags) {
      return json(400, { code: 400, msg: "Add a style, lyrics, or styles to avoid." });
    }
    if (!instrumental && !lyrics) {
      return json(400, { code: 400, msg: "Add lyrics, or switch on Instrumental." });
    }
    if (style) body.style = style;
    if (lyrics && !instrumental) body.lyrics = lyrics;
    if (negativeTags) body.negativeTags = negativeTags;
    if (title) body.title = title;
    if (input.vocalGender === "m" || input.vocalGender === "f") body.vocalGender = input.vocalGender;

    const duration = num(input.duration, 10, 360);
    if (duration !== undefined) body.duration = Math.round(duration);
    const styleWeight = num(input.styleWeight, 0, 1);
    if (styleWeight !== undefined) body.styleWeight = Math.round(styleWeight * 100) / 100;
    const weirdness = num(input.weirdnessConstraint, 0, 1);
    if (weirdness !== undefined) body.weirdnessConstraint = Math.round(weirdness * 100) / 100;
  }

  const result = await suno("/api/v1/generate", { method: "POST", body });
  const taskId = result?.data?.taskId;
  if (Number(result?.code) !== 200 || !taskId) return relay(result);

  // Save to the shared library right away; /api/status and /api/callback
  // fill in the tracks as Suno finishes them.
  const ownerToken = crypto.randomUUID();
  try {
    await store().setJSON(String(taskId), {
      taskId: String(taskId),
      createdAt: Date.now(),
      label: (customMode ? body.title || body.style || "Custom song" : body.prompt || body.style || "").slice(0, 200),
      detail: [model.replace("_", " "), instrumental ? "Instrumental" : "Vocals", customMode ? "Custom" : "Simple"].join(" · "),
      title: body.title || "",
      lyrics: body.lyrics || "",
      style: (body.style || "").slice(0, 300),
      status: "PENDING",
      tracks: [],
      ownerHash: await sha256(ownerToken),
    });
  } catch (err) {
    console.error("Could not save song to library", err);
  }
  return relay({ ...result, data: { ...result.data, ownerToken } });
};

export const config = { path: "/api/generate" };
