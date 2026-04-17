import { NextResponse } from "next/server";

function stripTrailingSlash(s) {
  return (s || "").replace(/\/+$/, "");
}

// GET — list diagnostic logs
export async function GET(req) {
  try {
    const backendBase = stripTrailingSlash(
      process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL
    );
    if (!backendBase) return NextResponse.json({ error: "Missing BACKEND_URL" }, { status: 500 });

    const { searchParams } = new URL(req.url);
    const limit = searchParams.get("limit") || "50";
    const skip = searchParams.get("skip") || "0";

    const res = await fetch(
      `${backendBase}/admin/diagnostics?limit=${encodeURIComponent(limit)}&skip=${encodeURIComponent(skip)}`,
      {
        method: "GET",
        headers: {
          accept: "application/json",
          "x-admin-token": process.env.ADMIN_API_TOKEN || "",
        },
        cache: "no-store",
      }
    );

    const j = await res.json().catch(() => ({}));
    if (!res.ok) return NextResponse.json(j, { status: res.status });
    return NextResponse.json(j);
  } catch (e) {
    return NextResponse.json({ error: e?.message || "Proxy failed" }, { status: 500 });
  }
}

// DELETE — clear all diagnostic logs
export async function DELETE(req) {
  try {
    const backendBase = stripTrailingSlash(
      process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL
    );
    if (!backendBase) return NextResponse.json({ error: "Missing BACKEND_URL" }, { status: 500 });

    const res = await fetch(
      `${backendBase}/admin/diagnostics`,
      {
        method: "DELETE",
        headers: {
          "x-admin-token": process.env.ADMIN_API_TOKEN || "",
        },
      }
    );

    const j = await res.json().catch(() => ({}));
    if (!res.ok) return NextResponse.json(j, { status: res.status });
    return NextResponse.json(j);
  } catch (e) {
    return NextResponse.json({ error: e?.message || "Proxy failed" }, { status: 500 });
  }
}
