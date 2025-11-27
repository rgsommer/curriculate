// src/api/tasksets.js

import { API_BASE_URL } from "../config";
const API_BASE = API_BASE_URL;

function buildAuthHeaders(base = {}) {
  try {
    const token =
      localStorage.getItem("curriculate_token") ||
      localStorage.getItem("token");
    if (!token) return base;
    return {
      ...base,
      Authorization: `Bearer ${token}`,
    };
  } catch {
    return base;
  }
}

async function parseJsonOrThrow(res, defaultMessage) {
  const text = await res.text();

  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (err) {
    console.error("Non-JSON response from tasksets endpoint:");
    console.error("Status:", res.status, res.statusText);
    console.error("URL:", res.url);
    console.error("Body (first 300 chars):", text.slice(0, 300));
  }

  if (!res.ok) {
    console.error("Tasksets API error:", data);
    const message =
      data?.message || data?.error || `${defaultMessage} (status ${res.status})`;
    throw new Error(message);
  }

  return data;
}

// 🔹 AI Taskset generation
export async function generateAiTaskset(payload) {
  console.log("🔸 Sending AI taskset generation payload:", payload);

  const res = await fetch(`${API_BASE}/api/ai/tasksets`, {
    method: "POST",
    headers: buildAuthHeaders({ "Content-Type": "application/json" }),
    credentials: "include",
    body: JSON.stringify(payload),
  });

  const data = await parseJsonOrThrow(res, "Failed to generate taskset");
  console.log("🔹 AI taskset raw response:", data);
  return data;
}

// 🔹 List all tasksets
export async function listMyTasksets() {
  const res = await fetch(`${API_BASE}/api/tasksets`, {
    headers: buildAuthHeaders(),
    credentials: "include",
  });
  return parseJsonOrThrow(res, "Failed to load task sets");
}

export async function fetchTaskset(id) {
  const res = await fetch(`${API_BASE}/api/tasksets/${id}`, {
    headers: buildAuthHeaders(),
    credentials: "include",
  });
  return parseJsonOrThrow(res, "Failed to load task set");
}
