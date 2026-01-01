const API_BASE =
  import.meta?.env?.VITE_API_BASE_URL || "https://api.curriculate.net";

export async function apiFetch(path, options = {}) {
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;

  // ✅ attach token if present (supports both keys you showed)
  let token = "";
  try {
    token =
      localStorage.getItem("curriculate_token") ||
      localStorage.getItem("token") ||
      "";
  } catch {}

  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  if (token && !headers.Authorization) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    credentials: "include",
    headers,
    ...options,
  });

  ...
  return res.json();
}

