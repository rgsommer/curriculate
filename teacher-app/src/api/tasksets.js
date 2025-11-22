// src/api/tasksets.js

import { API_BASE_URL } from "../config";
const API_BASE = API_BASE_URL;

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
    throw new Error(defaultMessage);
  }

  if (!res.ok) {
    console.error("Tasksets API error:", data);
    throw new Error(data?.error || defaultMessage);
  }

  return data;
}

// 🔹 AI Taskset generation
export async function generateAiTaskset(payload) {
  console.log("🔸 Sending AI taskset generation payload:", payload);

  const res = await fetch(`${API_BASE}/api/ai/tasksets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // credentials are optional here since we don't require auth on this route
    body: JSON.stringify(payload),
  });

  const data = await parseJsonOrThrow(res, "Failed to generate taskset");
  console.log("🔹 AI taskset raw response:", data);
  return data;
}

// 🔹 List all tasksets (for now, unfiltered)
export async function listMyTasksets() {
  const res = await fetch(`${API_BASE}/api/tasksets`);
  return parseJsonOrThrow(res, "Failed to load task sets");
}

export async function fetchTaskset(id) {
  const res = await fetch(`${API_BASE}/api/tasksets/${id}`);
  return parseJsonOrThrow(res, "Failed to load task set");
}
