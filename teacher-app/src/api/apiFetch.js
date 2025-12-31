const API_BASE =
  import.meta?.env?.VITE_API_BASE_URL ||
  "https://api.curriculate.net";

export async function apiFetch(path, options = {}) {
  const url = path.startsWith("http")
    ? path
    : `${API_BASE}${path}`;

  const res = await fetch(url, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!res.ok) {
    let errorBody = null;
    try {
      errorBody = await res.json();
    } catch {
      errorBody = await res.text();
    }

    throw new Error(
      errorBody?.error ||
        errorBody?.message ||
        `Request failed: ${res.status}`
    );
  }

  // handle 204
  if (res.status === 204) return null;

  return res.json();
}
