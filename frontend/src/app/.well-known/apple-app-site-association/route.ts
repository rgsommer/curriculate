import { NextResponse } from "next/server";

// iOS Universal Links: lets https://curriculate.net links to Campfire open in the
// installed app instead of Safari. Apple fetches this (no redirects allowed) for every
// applinks: domain in the app's Associated Domains entitlement.
//
// Covered: short card links, invites, engagement/group pages (what emails and pushes
// link to), and the dashboard. Deliberately NOT covered: /campfirelive/auth/* — the
// sign-in and password-reset callbacks carry session tokens in the URL fragment and
// must finish in the browser that started them.
export const dynamic = "force-static";

const APP_ID = "8XSHU49K2X.net.curriculate.campfire";

export function GET() {
  return NextResponse.json(
    {
      applinks: {
        details: [
          {
            appIDs: [APP_ID],
            components: [
              { "/": "/c/*" },
              { "/": "/campfirelive/join/*" },
              { "/": "/campfirelive/group/*" },
              { "/": "/campfirelive" },
            ],
          },
        ],
      },
    },
    { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" } }
  );
}
