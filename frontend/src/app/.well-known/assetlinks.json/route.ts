import { NextResponse } from "next/server";

// Android App Links: proves net.curriculate.campfire owns curriculate.net so its
// verified https intent filters open Campfire links straight in the app.
//
// Two certificates sign Campfire builds, and both must be listed:
//   • the UPLOAD key (sideloaded / internal builds) — fixed below;
//   • Google Play's APP SIGNING key (every install from the Play Store). Copy its
//     SHA-256 from Play Console → Campfire → Test and release → App integrity → App
//     signing, and set it as ANDROID_APP_SIGNING_SHA256 on Vercel (comma-separate if
//     there are several). Until then, store installs won't verify.
export const dynamic = "force-dynamic";

const UPLOAD_KEY_SHA256 =
  "26:CE:38:3E:D2:B0:9F:05:42:41:83:97:F2:88:CC:7C:FE:15:13:C7:DB:AD:12:3C:39:64:4D:EC:AE:FD:C1:CD";

export function GET() {
  const extra = (process.env.ANDROID_APP_SIGNING_SHA256 || "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(s));
  return NextResponse.json(
    [
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: "net.curriculate.campfire",
          sha256_cert_fingerprints: Array.from(new Set([UPLOAD_KEY_SHA256, ...extra])),
        },
      },
    ],
    { headers: { "Cache-Control": "public, max-age=3600" } }
  );
}
