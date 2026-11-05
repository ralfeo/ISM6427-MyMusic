import { checkAccess, suno, relay } from "../lib/suno.mjs";

// GET /api/credits — remaining Suno API credits.
export default async (req) => {
  const denied = checkAccess(req);
  if (denied) return denied;
  return relay(await suno("/api/v1/generate/credit"));
};

export const config = { path: "/api/credits" };
