// Suno requires a callBackUrl on every task. The app polls /api/status instead,
// so this receiver simply acknowledges the webhook (must answer 200 quickly).
export default async () =>
  new Response(JSON.stringify({ code: 200, msg: "received" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

export const config = { path: "/api/callback" };
