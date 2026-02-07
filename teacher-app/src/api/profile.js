// teacher-app/src/api/profile.js

import { API_BASE_URL } from "../config";

const API_BASE = (API_BASE_URL || "").replace(/\/$/, "");

function safeGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function getToken() {
  // Prefer the “real” key, but support dev/staging keys too.
  const candidates = [
    "token",
    "curriculate_token",
    "authToken",
    "curriculateToken",
  ];

  for (const k of candidates) {
    const v = safeGet(k);
    if (v && String(v).trim()) return String(v).trim();
  }
  return null;
}

async function readText(res) {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

async function parseJsonOrThrow(res, defaultMessage) {
  const text = await readText(res);

  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // If server didn’t return JSON, surface a helpful error
    const hint = text ? ` Server said: ${text.slice(0, 200)}` : "";
    throw new Error(defaultMessage + hint);
  }

  if (!res.ok) {
    throw new Error(data?.error || defaultMessage);
  }
  return data;
}

function authHeaders(extra = {}) {
  const token = getToken();
  return {
    ...extra,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function fetchMyProfile() {
  const res = await fetch(`${API_BASE}/api/profile`, {
    method: "GET",
    headers: authHeaders(),
    credentials: "include",
  });

  // If you want the old behavior (just “Failed to load profile”), keep it.
  // This gives you a more explicit message when token is missing.
  if (res.status === 401) {
    const token = getToken();
    throw new Error(
      token
        ? "Unauthorized (token rejected/expired)."
        : "Missing auth token (no token found in localStorage)."
    );
  }

  return parseJsonOrThrow(res, "Failed to load profile");
}

export async function updateMyProfile(payload) {
  const res = await fetch(`${API_BASE}/api/profile`, {
    method: "PUT",
    headers: authHeaders({ "Content-Type": "application/json" }),
    credentials: "include",
    body: JSON.stringify(payload || {}),
  });

  if (res.status === 401) {
    const token = getToken();
    throw new Error(
      token
        ? "Unauthorized (token rejected/expired)."
        : "Missing auth token (no token found in localStorage)."
    );
  }

  return parseJsonOrThrow(res, "Failed to save profile");
}
