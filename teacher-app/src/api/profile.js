// teacher-app/src/api/profile.js
import { API_BASE_URL } from "../config";
const API_BASE = API_BASE_URL;

async function parseJsonOrThrow(res, defaultMessage) {
  const text = await res.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    console.error("Non-JSON response from /api/profile endpoint:", text.slice(0, 300));
    throw new Error(defaultMessage);
  }

  if (!res.ok) {
    throw new Error(data?.error || defaultMessage);
  }
  return data;
}

function getAuthHeaders() {
  // Your codebase already uses localStorage.getItem("token") in places. :contentReference[oaicite:2]{index=2}
  const token =
    typeof window !== "undefined" ? localStorage.getItem("token") : null;

  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function fetchMyProfile() {
  const res = await fetch(`${API_BASE}/api/profile`, {
    method: "GET",
    headers: {
      ...getAuthHeaders(),
    },
    // You can leave cookies on, but the key fix is the Bearer token.
    credentials: "include",
  });

  return parseJsonOrThrow(res, "Failed to load profile");
}

export async function updateMyProfile(payload) {
  const res = await fetch(`${API_BASE}/api/profile`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeaders(),
    },
    credentials: "include",
    body: JSON.stringify(payload || {}),
  });

  return parseJsonOrThrow(res, "Failed to save profile");
}
