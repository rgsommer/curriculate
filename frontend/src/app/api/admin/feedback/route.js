import { NextResponse } from "next/server";

function stripTrailingSlash(s) {
  return (s || "").replace(/\/+$/, "");
}

// PATCH — archive or restore
export async function PATCH(req) {
  try {
    const backendBase = stripTrailingSlash(
      process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL
    );
    if (!backendBase) return NextResponse.json({ error: "Missing BACKEND_URL" }, { status: 500 });

    const body = await req.json().catch(() => ({}));
    const { id, action } = body; // action: "archive" | "restore"
    if (!id || !["archive", "restore"].includes(action)) {
      return NextResponse.json({ error: "Missing id or invalid action" }, { status: 400 });
    }

    const res = await fetch(`${backendBase}/admin/feedback/${encodeURIComponent(id)}/${action}`, {
      method: "PATCH",
      headers: { "x-admin-token": process.env.ADMIN_API_TOKEN || "" },
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return NextResponse.json(j, { status: res.status });
    return NextResponse.json(j);
  } catch (e) {
    return NextResponse.json({ error: e?.message || "Proxy failed" }, { status: 500 });
  }
}

// DELETE — permanent delete
export async function DELETE(req) {
  try {
    const backendBase = stripTrailingSlash(
      process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL
    );
    if (!backendBase) return NextResponse.json({ error: "Missing BACKEND_URL" }, { status: 500 });

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const res = await fetch(`${backendBase}/admin/feedback/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { "x-admin-token": process.env.ADMIN_API_TOKEN || "" },
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return NextResponse.json(j, { status: res.status });
    return NextResponse.json(j);
  } catch (e) {
    return NextResponse.json({ error: e?.message || "Proxy failed" }, { status: 500 });
  }
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
    const archived = searchParams.get("archived") === "true" ? "&archived=true" : "";

    const url = `${backendBase}/admin/feedback?limit=${encodeURIComponent(limit)}${archived}`;

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