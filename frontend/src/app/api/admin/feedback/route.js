import { NextResponse } from "next/server";

function stripTrailingSlash(s) {
  return (s || "").replace(/\/+$/, "");
}

export async function GET(req) {
  try {
    const backendBase = stripTrailingSlash(
      process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL
    );

    if (!backendBase) {
      return NextResponse.json({ error: "Missing BACKEND_URL" }, { status: 500 });
    }

    const { searchParams } = new URL(req.url);
    const limit = searchParams.get("limit") || "80";

    const url = `${backendBase}/admin/feedback?limit=${encodeURIComponent(limit)}`;

    const res = await fetch(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        "x-admin-token": process.env.ADMIN_API_TOKEN || "",
      },
      cache: "no-store",
    });

    const text = await res.text();
    let j = null;
    try { j = JSON.parse(text); } catch {}

    if (!res.ok) {
      return NextResponse.json(
        { error: j?.error || `HTTP ${res.status}`, details: text?.slice(0, 300) },
        { status: res.status }
      );
    }

    return NextResponse.json(j || { items: [] });
  } catch (e) {
    return NextResponse.json({ error: e?.message || "Proxy failed" }, { status: 500 });
  }
}