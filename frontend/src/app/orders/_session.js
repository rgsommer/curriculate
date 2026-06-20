"use client";

// Shared client helpers for orders sign-in. A teacher already signed in elsewhere
// on curriculate.net (e.g. Behaviours) has a "curriculate_auth_token" in
// localStorage — trySso() exchanges it for an orders session so they skip the code.

export function getStoredSession() {
  try {
    const session = localStorage.getItem("orders_session");
    const email = localStorage.getItem("orders_email");
    const isAdmin = localStorage.getItem("orders_isAdmin") === "1";
    const name = localStorage.getItem("orders_name") || "";
    if (session && email) return { session, email, isAdmin, name };
  } catch {}
  return null;
}

export function storeSession({ session, email, isAdmin, name }) {
  try {
    localStorage.setItem("orders_session", session);
    localStorage.setItem("orders_email", email);
    localStorage.setItem("orders_isAdmin", isAdmin ? "1" : "0");
    if (name) localStorage.setItem("orders_name", name);
  } catch {}
}

export function clearSession() {
  try {
    localStorage.removeItem("orders_session");
    localStorage.removeItem("orders_email");
    localStorage.removeItem("orders_isAdmin");
  } catch {}
}

export function getCurriculateToken() {
  try {
    return localStorage.getItem("curriculate_auth_token");
  } catch {
    return null;
  }
}

// Re-check admin status live (config may have changed since login, e.g. this
// person was just added as a 2nd finance account). Updates the cached flag.
// Returns { valid:true, isAdmin, email } | { valid:false } (session expired/invalid)
// | null (transient/network error — keep the cached flag).
export async function refreshAdmin(session) {
  if (!session) return { valid: false };
  try {
    const r = await fetch("/api/orders/whoami?session=" + encodeURIComponent(session));
    if (r.status === 401) return { valid: false }; // session expired/invalid
    if (!r.ok) return null; // server hiccup — don't sign the user out
    const j = await r.json();
    if (!j.ok) return { valid: false };
    try { localStorage.setItem("orders_isAdmin", j.isAdmin ? "1" : "0"); } catch {}
    return { valid: true, email: j.email, isAdmin: !!j.isAdmin };
  } catch {
    return null; // network error — keep cached
  }
}

// Attempt single-sign-on from an existing Curriculate/Behaviours login.
// Returns { session, email, isAdmin, name } on success, or null.
export async function trySso() {
  const token = getCurriculateToken();
  if (!token) return null;
  try {
    const r = await fetch("/api/orders/auth/sso", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    if (!j.ok) return null;
    const out = { session: j.session, email: j.email, isAdmin: !!j.isAdmin, name: j.name || "" };
    storeSession(out);
    return out;
  } catch {
    return null;
  }
}
