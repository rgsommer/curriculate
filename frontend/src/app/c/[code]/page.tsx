import { redirect } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

// Short, friendly card link: /c/<share_code>. Resolves the engagement's group
// invite code with the service role (so a not-yet-signed-in visitor works) and
// forwards into the guest join flow (?e=… → join just this card).
export const dynamic = "force-dynamic";

export default async function ShortCardRedirect({
  params,
  searchParams,
}: {
  params: { code: string };
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  const code = (params.code || "").trim();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (code && url && serviceKey) {
    const admin = createClient(url, serviceKey);
    const { data } = await admin
      .from("engagements")
      .select("id, group:groups(invite_code)")
      .ilike("share_code", code)
      .maybeSingle();

    const group = Array.isArray(data?.group) ? data?.group[0] : data?.group;
    const inviteCode = (group as { invite_code?: string } | undefined)?.invite_code;

    if (data?.id && inviteCode) {
      const invRaw = searchParams?.inv;
      const inv = typeof invRaw === "string" ? invRaw : "";
      const qs = `?e=${data.id}${inv ? `&inv=${encodeURIComponent(inv)}` : ""}`;
      redirect(`/campfirelive/join/${inviteCode}${qs}`);
    }
  }

  // Unknown / expired code → send them to the app rather than a dead page.
  redirect("/campfirelive");
}
