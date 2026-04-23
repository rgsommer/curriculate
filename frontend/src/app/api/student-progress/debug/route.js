import { NextResponse } from "next/server";

function stripTrailingSlash(s) {
  return (s || "").replace(/\/+$/, "");
}

export async function GET(req) {
  try {
    const backendBase = stripTrailingSlash(
      process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL
    );
    if (!backendBase) return NextResponse.json({ error: "Missing BACKEND_URL" }, { status: 500 });

    const { searchParams } = new URL(req.url);
    const email = searchParams.get("email") || "";

    const res = await fetch(
      `${backendBase}/student-progress/debug?email=${encodeURIComponent(email)}`,
      { method: "GET", headers: { accept: "application/json" }, cache: "no-store" }
    );

    const j = await res.json().catch(() => ({}));
    if (!res.ok) return NextResponse.json(j, { status: res.status });
    return NextResponse.json(j);
  } catch (e) {
    return NextResponse.json({ error: e?.message || "Proxy failed" }, { status: 500 });
  }
}
