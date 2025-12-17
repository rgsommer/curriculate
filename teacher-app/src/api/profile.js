// teacher-app/src/api/profile.js
import { API_BASE_URL } from "../config";
const API_BASE = API_BASE_URL;

async function parseJsonOrThrow(res, defaultMessage) {
  const text = await res.text().catch(() => "");
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(defaultMessage);
  }
  if (!res.ok) throw new Error(data?.error || defaultMessage);
  return data;
}

function getToken() {
  try {
    return localStorage.getItem("token");
  } catch {
    return null;
  }
}

export async function fetchMyProfile() {
  const token = getToken();
  const res = await fetch(`${API_BASE}/api/profile`, {
    method: "GET",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: "include",
  });
  return parseJsonOrThrow(res, "Failed to load profile");
}

export async function updateMyProfile(payload) {
  const token = getToken();
  const res = await fetch(`${API_BASE}/api/profile`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    credentials: "include",
    body: JSON.stringify(payload || {}),
  });
  return parseJsonOrThrow(res, "Failed to save profile");
}
