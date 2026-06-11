import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// The native app posts its device push token here after registering. We store it
// per user so push sends (phase 2, via APNs/FCM) can target the device.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const token = typeof body?.token === "string" ? body.token : "";
    const platform = typeof body?.platform === "string" ? body.platform : null;
    if (!token) {
      return NextResponse.json({ error: "Missing token" }, { status: 400 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey) {
      return NextResponse.json({ error: "Not configured" }, { status: 500 });
    }

    const jwt = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!jwt) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }
    const admin = createClient(url, serviceKey);
    const { data, error } = await admin.auth.getUser(jwt);
    if (error || !data?.user) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }

    await admin.from("campfire_push_tokens").upsert(
      {
        user_id: data.user.id,
        token,
        platform,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,token" }
    );
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
