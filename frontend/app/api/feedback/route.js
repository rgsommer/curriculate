// frontend/app/api/feedback/route.js

import { NextResponse } from "next/server";

function stripTrailingSlash(s) {
  return (s || "").replace(/\/+$/, "");
}

function backendBase() {
  return stripTrailingSlash(
    process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL
  );
}

export async function POST(req) {
  try {
    const base = backendBase();
    if (!base) {
      return NextResponse.json({ error: "Missing BACKEND_URL" }, { status: 500 });
    }

    const body = await req.json();
    const url = `${base}/feedback`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        cookie: req.headers.get("cookie") || "",
      },
      body: JSON.stringify(body),
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

    return NextResponse.json(j || { ok: true });
  } catch (e) {
    return NextResponse.json({ error: e?.message || "Proxy failed" }, { status: 500 });
  }
}