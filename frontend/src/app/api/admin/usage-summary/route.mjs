// frontend/app/api/admin/usage-summary/route.js
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req) {
  try {
    const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL;
    const ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN;

    if (!BACKEND_URL) return NextResponse.json({ error: "Missing NEXT_PUBLIC_BACKEND_URL" }, { status: 500 });
    if (!ADMIN_API_TOKEN) return NextResponse.json({ error: "Missing ADMIN_API_TOKEN" }, { status: 500 });

    const url = new URL(req.url);
    const force = url.searchParams.get("force") === "true";

    const upstream = await fetch(
      `${BACKEND_URL.replace(/\/$/, "")}/admin/usage-summary${force ? "?force=true" : ""}`,
      {
        method: "GET",
        headers: { "x-admin-token": ADMIN_API_TOKEN, Accept: "application/json" },
        cache: "no-store",
      }
    );

    const text = await upstream.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { error: "Upstream returned non-JSON", raw: text.slice(0, 2000) }; }

    return NextResponse.json(data, { status: upstream.status });
  } catch (err) {
    return NextResponse.json({ error: err?.message || "Proxy failed" }, { status: 500 });
  }
}
