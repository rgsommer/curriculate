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
