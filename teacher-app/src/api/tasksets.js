// src/api/tasksets.js

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:10000";

async function parseJsonOrThrow(res, defaultMessage) {
  const text = await res.text();

  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    console.error("Non-JSON response from /api/tasksets endpoint:", text.slice(0, 300));
    throw new Error(defaultMessage);
  }

  if (!res.ok) {
    throw new Error(data?.error || defaultMessage);
  }
  return data;
}

export async function generateAiTaskset(payload) {
  const res = await fetch(`${API_BASE}/api/ai/tasksets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow(res, "Failed to generate taskset");
}

export async function listMyTasksets() {
  const res = await fetch(`${API_BASE}/api/tasksets`, {
    credentials: "include",
  });
  return parseJsonOrThrow(res, "Failed to load task sets");
}

export async function fetchTaskset(id) {
  const res = await fetch(`${API_BASE}/api/tasksets/${id}`, {
    credentials: "include",
  });
  return parseJsonOrThrow(res, "Failed to load task set");
}
