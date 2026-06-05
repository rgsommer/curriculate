import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");

  if (code) {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    const { data } = await supabase.auth.exchangeCodeForSession(code);

    // Guarantee a profile row exists for this user. The handle_new_user trigger
    // normally creates it, but this is a server-side safety net so that any user
    // who slips through (pre-existing account, trigger hiccup) can still use the
    // app — every Campfire table foreign-keys to profiles. Uses the service-role
    // client because RLS has no INSERT policy on profiles.
    const authUser = data.session?.user;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (authUser && serviceKey) {
      try {
        const admin = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          serviceKey
        );
        const meta = (authUser.user_metadata ?? {}) as Record<string, unknown>;
        const displayName =
          (meta.display_name as string) ||
          (meta.full_name as string) ||
          (meta.name as string) ||
          authUser.email?.split("@")[0] ||
          "Member";
        await admin.from("profiles").upsert(
          {
            id: authUser.id,
            display_name: displayName,
            avatar_url:
              (meta.avatar_url as string) ?? (meta.picture as string) ?? null,
          },
          { onConflict: "id", ignoreDuplicates: true }
        );
      } catch {
        // Never block sign-in on profile creation — the trigger is the primary path.
      }
    }
  }

  return NextResponse.redirect(new URL("/campfirelive", request.url));
}
