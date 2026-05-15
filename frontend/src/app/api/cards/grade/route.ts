/**
 * DEPRECATED — this route has been moved to the Express backend.
 *
 * The /cards page now POSTs to ${NEXT_PUBLIC_BACKEND_URL}/cards/grade,
 * which is implemented in backend/routes/cards.js. That's where
 * OPENAI_API_KEY lives (Render env).
 *
 * Safe to delete this whole `frontend/src/app/api/cards/` directory:
 *     rm -rf frontend/src/app/api/cards
 *
 * Left in place only because the sandbox that wrote it can't unlink it.
 */
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json(
    { error: "Moved. POST to {NEXT_PUBLIC_BACKEND_URL}/cards/grade instead." },
    { status: 410 }
  );
}
