import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Short branded redirect for social posts:
//   curriculate.net/thanks                 → generic thank-you card
//   curriculate.net/thanks?for=coach       → coach thank-you
//   curriculate.net/thanks?for=teacher     → teacher appreciation
//   …?ref=CODE                             → referral attribution (or the default
//                                            operator code via CAMPFIRE_DEFAULT_REF)
// Lands on the dashboard's one-tap "start a thank-you card" flow.
export function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const forWho = (sp.get("for") || "").toLowerCase();
  const template =
    forWho === "coach"
      ? "coach-gift"
      : forWho === "teacher"
      ? "teacher-appreciation"
      : forWho === "christmas"
      ? "christmas-card"
      : "thank-you-card";
  const ref = sp.get("ref") || process.env.CAMPFIRE_DEFAULT_REF || null;

  const dest = new URL("/campfirelive", req.nextUrl.origin);
  dest.searchParams.set("start", template);
  if (ref) dest.searchParams.set("ref", ref);
  return NextResponse.redirect(dest, 307);
}
