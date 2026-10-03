import { supabase } from "./supabase";
import { cap, nativePlatform, nativePushCapable } from "./native";

// Native push, done politely: never prompt on launch. We register silently only when
// the user has ALREADY granted permission, and otherwise wait for them to opt in from
// the in-app prompt (PushPrompt) after they've joined a group. A token is only useful
// with a signed-in session, so every registration posts it with the user's JWT.

export type PushStatus = "unsupported" | "prompt" | "granted" | "denied";

export async function pushStatus(): Promise<PushStatus> {
  if (!nativePushCapable()) return "unsupported";
  try {
    const p = await cap()!.Plugins!.PushNotifications!.checkPermissions();
    if (p.receive === "granted") return "granted";
    if (p.receive === "denied") return "denied";
    return "prompt";
  } catch {
    return "unsupported";
  }
}

let listening = false;

async function postToken(token: string) {
  const { data } = await supabase.auth.getSession();
  const jwt = data.session?.access_token;
  if (!jwt) return; // signed out — the next sign-in re-registers
  await fetch("/api/campfire/push/register", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ token, platform: nativePlatform() }),
  }).catch(() => {});
}

// Register this device (permission must already be granted). Safe to call repeatedly:
// the OS hands back the same token and the server upserts it.
export async function registerPush(): Promise<void> {
  if (!nativePushCapable()) return;
  const push = cap()!.Plugins!.PushNotifications!;
  if (!listening) {
    listening = true;
    await push.addListener("registration", (t: unknown) => {
      const value = (t as { value?: string })?.value;
      if (value) postToken(value);
    });
  }
  await push.register();
}

// Called from the in-app prompt's "Turn on" button — the only place we ask.
export async function enablePush(): Promise<PushStatus> {
  if (!nativePushCapable()) return "unsupported";
  try {
    const p = await cap()!.Plugins!.PushNotifications!.requestPermissions();
    if (p.receive !== "granted") return p.receive === "denied" ? "denied" : "prompt";
    await registerPush();
    return "granted";
  } catch {
    return "unsupported";
  }
}
