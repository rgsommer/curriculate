// frontend/src/app/api/teebeepay/me/route.ts
// GET → { user } if authToken valid; 401 otherwise.
import { NextResponse } from "next/server";
import { readAuth } from "../_auth";

export async function GET(req: Request) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({
    user: {
      uid: u.uid, email: u.email, role: u.role,
      clearance: u.clearance, company_id: u.company_id,
    },
  });
}
