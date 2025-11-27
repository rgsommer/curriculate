// teacher-app/src/api/tasksets.js

import { API_BASE_URL } from "../config";

const API_BASE = API_BASE_URL;

/* -----------------------------------------------------------------------
 *  Build Authorization Header
 * --------------------------------------------------------------------- */
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

/* -----------------------------------------------------------------------
 *  Safe JSON parsing with good diagnostics
 * --------------------------------------------------------------------- */
async function parseJsonOrThrow(res, defaultMessage) {
  const text = await res.text();
  let data = null;

  // Try parsing JSON safely
  try {
    data = text ? JSON.parse(text) : null;
  } catch (err) {
    console.error("⚠️ tasksets.js: Non-JSON API response");
    console.error("URL:", res.url);
    console.error("Status:", res.status, res.statusText);
    console.error("Raw body (first 300 chars):", text.slice(0, 300));
  }

  if (!res.ok) {
    const message =
      data?.message ||
      data?.error ||
      `${defaultMessage} (status ${res.status})`;
    console.error("❌ Tasksets API error:", message, data);
    throw new Error(message);
  }

  return data;
}

/* -----------------------------------------------------------------------
 *  AI Task Set Generation (AUTH REQUIRED)
 * --------------------------------------------------------------------- */
export async function generateAiTaskset(payload) {
  console.log("🔸 Sending AI TaskSet generation payload:", payload);

  const res = await fetch(`${API_BASE}/api/ai/tasksets`, {
    method: "POST",
    headers: buildAuthHeaders({
      "Content-Type": "application/json",
    }),
    credentials: "include", // send cookies if needed
    body: JSON.stringify(payload),
  });

  const data = await parseJsonOrThrow(res, "Failed to generate task set");

  console.log("🔹 AI TaskSet raw response:", data);
  return data;
}

/* -----------------------------------------------------------------------
 *  List Teacher’s TaskSets (AUTH REQUIRED)
 * --------------------------------------------------------------------- */
export async function listMyTasksets() {
  const res = await fetch(`${API_BASE}/api/tasksets`, {
    method: "GET",
    headers: buildAuthHeaders(),
    credentials: "include",
  });

  return parseJsonOrThrow(res, "Failed to load task sets");
}

/* -----------------------------------------------------------------------
 *  Fetch One TaskSet (AUTH REQUIRED)
 * --------------------------------------------------------------------- */
export async function fetchTaskset(id) {
  const res = await fetch(`${API_BASE}/api/tasksets/${id}`, {
    headers: buildAuthHeaders(),
    credentials: "include",
  });

  return parseJsonOrThrow(res, "Failed to load task set");
}

/* -----------------------------------------------------------------------
 *  Save (Create or Update) a TaskSet (AUTH REQUIRED)
 * --------------------------------------------------------------------- */
export async function saveTaskset(taskset) {
  const isUpdate = !!taskset._id;

  const url = isUpdate
    ? `${API_BASE}/api/tasksets/${taskset._id}`
    : `${API_BASE}/api/tasksets`;

  const method = isUpdate ? "PUT" : "POST";

  const res = await fetch(url, {
    method,
    headers: buildAuthHeaders({
      "Content-Type": "application/json",
    }),
    credentials: "include",
    body: JSON.stringify(taskset),
  });

  return parseJsonOrThrow(res, "Failed to save task set");
}

/* -----------------------------------------------------------------------
 *  Delete a TaskSet (AUTH REQUIRED)
 * --------------------------------------------------------------------- */
export async function deleteTaskset(id) {
  const res = await fetch(`${API_BASE}/api/tasksets/${id}`, {
    method: "DELETE",
    headers: buildAuthHeaders(),
    credentials: "include",
  });

  return parseJsonOrThrow(res, "Failed to delete task set");
}
