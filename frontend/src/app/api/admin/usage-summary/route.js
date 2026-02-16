import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req) {
  try {
    const token = String(process.env.ADMIN_API_TOKEN || "").trim();
    if (!token) {
      return NextResponse.json(
        { error: "Missing ADMIN_API_TOKEN on Vercel" },
        { status: 500 }
      );
    }

    const url = new URL(req.url);
    const force = url.searchParams.get("force") === "true";

    const backendBase = String(process.env.NEXT_PUBLIC_BACKEND_URL || "https://api.curriculate.net").replace(/\/$/, "");
    const upstreamUrl = `${backendBase}/admin/usage-summary${force ? "?force=true" : ""}`;

    const upstream = await fetch(upstreamUrl, {
      headers: {
        // backend expects this:
        "x-admin-token": token,
        Accept: "application/json",
      },
      cache: "no-store",
    });

    const ct = upstream.headers.get("content-type") || "";
    const body = await upstream.text();

    // If upstream returns non-JSON (HTML error page), return JSON explaining it
    if (!ct.includes("application/json")) {
      return NextResponse.json(
        {
          error: "Upstream did not return JSON",
          upstreamStatus: upstream.status,
          upstreamContentType: ct,
          upstreamPreview: body.slice(0, 300),
        },
        { status: 502 }
      );
    }

    // Pass JSON through
    return new NextResponse(body, {
      status: upstream.status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: "Proxy failed", details: e?.message || String(e) },
      { status: 500 }
    );
  }
}
