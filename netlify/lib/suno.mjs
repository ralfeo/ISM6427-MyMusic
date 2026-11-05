// Shared helpers for talking to the Suno API (https://docs.sunoapi.org).
// The API key lives only in Netlify environment variables — never in the browser.

const BASE = (process.env.SUNO_API_BASE || "https://api.sunoapi.org").replace(/\/+$/, "");

export function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// Optional shared password so strangers can't burn your credits.
// Set APP_PASSWORD in Netlify to enable; leave unset for an open app.
export function checkAccess(req) {
  const required = process.env.APP_PASSWORD;
  if (!required) return null;
  if (req.headers.get("x-app-password") === required) return null;
  return json(401, { code: 401, msg: "Wrong or missing app password." });
}

export function callbackUrl(req) {
  // Suno requires a callBackUrl. We poll for results, so this just points at a
  // no-op receiver on this same site.
  const origin = process.env.URL || new URL(req.url).origin;
  return `${origin}/api/callback`;
}

export async function suno(path, { method = "GET", body, query } = {}) {
  const key = process.env.SUNO_API_KEY;
  if (!key) {
    return { code: 500, msg: "Server is missing SUNO_API_KEY. Add it in Netlify → Site configuration → Environment variables." };
  }
  const url = new URL(BASE + path);
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { code: res.status || 500, msg: `Unexpected response from Suno API: ${text.slice(0, 200)}` };
  }
}

// Suno returns HTTP 200 with a `code` field; map it to a real HTTP status.
export function relay(result) {
  const code = Number(result?.code) || 500;
  const status = code === 200 ? 200 : code >= 400 && code < 600 ? code : 502;
  return json(status, result);
}
