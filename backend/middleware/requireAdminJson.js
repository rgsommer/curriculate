// backend/middleware/requireAdminJson.js
// Drop-in middleware: returns JSON for normal requests, and SSE-formatted errors for EventSource.
//
// Usage example:
//   import { requireAdminJson } from "./middleware/requireAdminJson.js";
//   router.get("/access-codes", requireAuth, requireAdminJson, listAccessCodes);
//   router.get("/taskset/stream", requireAuth, requireAdminJson, streamDemoTaskset);

function writeSseError(res, status, message) {
  // EventSource treats non-200 as a network error and won't surface the body.
  // For SSE, return 200 and send the error as an event payload instead.
  res.statusCode = 200;

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  res.write(`event: fatal\n`);
  res.write(`data: ${JSON.stringify({ ok: false, error: message })}\n\n`);
  try { res.end(); } catch {}
}

export function requireAdminJson(req, res, next) {
  // Assumes an upstream auth middleware has attached req.user
  const u = req.user;
  const isAdmin = !!(u && (u.isAdmin === true || u.role === "admin"));

  if (isAdmin) return next();

  const accept = String(req.headers.accept || "");
  const wantsSse = accept.includes("text/event-stream");

  if (wantsSse) {
    return writeSseError(res, 403, "Admin only.");
  }

  return res.status(403).json({ ok: false, error: "Admin only." });
}
