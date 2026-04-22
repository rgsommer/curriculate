import { NextResponse } from "next/server";

function stripTrailingSlash(s) {
  return (s || "").replace(/\/+$/, "");
}

// GET — list teachers + templates
export async function GET() {
  try {
    const backendBase = stripTrailingSlash(
      process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL
    );
    if (!backendBase) {
      return NextResponse.json({ error: "Missing BACKEND_URL" }, { status: 500 });
    }

    const res = await fetch(`${backendBase}/admin/teacher-outreach`, {
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
        { error: j?.error || `HTTP ${res.status}` },
        { status: res.status }
      );
    }
    return NextResponse.json(j || { teachers: [], templates: [] });
  } catch (e) {
    return NextResponse.json({ error: e?.message || "Proxy failed" }, { status: 500 });
  }
}

// POST — send emails
export async function POST(req) {
  try {
    const backendBase = stripTrailingSlash(
      process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL
    );
    if (!backendBase) {
      return NextResponse.json({ error: "Missing BACKEND_URL" }, { status: 500 });
    }

    const body = await req.json();

    const res = await fetch(`${backendBase}/admin/teacher-outreach/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-token": process.env.ADMIN_API_TOKEN || "",
      },
      body: JSON.stringify(body),
    });

    const text = await res.text();
    let j = null;
    try { j = JSON.parse(text); } catch {}

    if (!res.ok) {
      return NextResponse.json(
        { error: j?.error || `HTTP ${res.status}` },
        { status: res.status }
      );
    }
    return NextResponse.json(j || { ok: true });
  } catch (e) {
    return NextResponse.json({ error: e?.message || "Proxy failed" }, { status: 500 });
  }
}
