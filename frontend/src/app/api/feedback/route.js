// frontend/src/app/api/admin/feedback/route.js
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

    // Forward admin token from browser -> Next -> backend
    const adminToken = req.headers.get("x-admin-token") || "";

    const url = `${backendBase}/admin/feedback?limit=${encodeURIComponent(limit)}`;

    const res = await fetch(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        "x-admin-token": adminToken,
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