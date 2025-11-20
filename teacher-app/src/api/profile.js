// src/api/profile.js

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:10000";

async function parseJsonOrThrow(res, defaultMessage) {
  const text = await res.text();

  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    console.error(
      "Non-JSON response from /api/profile endpoint:",
      text.slice(0, 300)
    );
    throw new Error(defaultMessage);
  }

  if (!res.ok) {
    throw new Error(data?.error || defaultMessage);
  }
  return data;
}

export async function fetchMyProfile() {
  const res = await fetch(`${API_BASE}/api/profile/me`, {
    credentials: "include",
  });
  return parseJsonOrThrow(res, "Failed to load profile");
}

export async function updateMyProfile(payload) {
  const res = await fetch(`${API_BASE}/api/profile/me`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow(res, "Failed to save profile");
}
