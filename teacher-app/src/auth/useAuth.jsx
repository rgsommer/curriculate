// teacher-app/src/auth/useAuth.jsx
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

const AuthContext = createContext(null);

function getApiBase() {
  // 1) Prefer VITE_API_BASE when present
  const envBase = (() => {
    try {
      return import.meta?.env?.VITE_API_BASE;
    } catch {
      return null;
    }
  })();

  if (envBase && String(envBase).trim()) {
    return String(envBase).trim().replace(/\/+$/, "");
  }

  // 2) Hard fallback for production (prevents hitting set.curriculate.net)
  // You can change this later, but this will immediately stop 405s.
  if (typeof window !== "undefined") {
    const host = window.location.host;
    if (host === "set.curriculate.net") return "https://set.curriculate.net";
  }

  // 3) Local dev fallback
  return "";
}

function lsGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key, val) {
  try {
    localStorage.setItem(key, val);
  } catch {}
}
function lsDel(key) {
  try {
    localStorage.removeItem(key);
  } catch {}
}

export function AuthProvider({ children }) {
  const API_BASE = getApiBase();

  const [token, setToken] = useState(() => lsGet("token") || lsGet("curriculate_token") || null);
  const [user, setUser] = useState(null);
  const [initializing, setInitializing] = useState(true);
  const [authError, setAuthError] = useState("");

  const isAuthenticated = !!token;

  const authHeaders = useMemo(() => {
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [token]);

  async function loadMe(activeToken) {
    if (!activeToken) {
      setUser(null);
      return;
    }

    const res = await fetch(`${API_BASE}/api/profile`, {
      headers: {
        ...authHeaders,
      },
    });

    if (res.status === 401) {
      // token missing/invalid
      lsDel("token");
      lsDel("curriculate_token");
      setToken(null);
      setUser(null);
      throw new Error("Unauthorized");
    }

    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }

    if (!res.ok) throw new Error(data?.error || "Failed to load profile");
    setUser(data);
  }

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setInitializing(true);
      setAuthError("");
      try {
        if (!token) {
          setUser(null);
        } else {
          // build headers using the token we have *right now*
          const res = await fetch(`${API_BASE}/api/profile`, {
            headers: { Authorization: `Bearer ${token}` },
          });

          if (res.status === 401) {
            if (!cancelled) {
              lsDel("token");
              lsDel("curriculate_token");
              setToken(null);
              setUser(null);
            }
            return;
          }

          const text = await res.text();
          let data = null;
          try {
            data = text ? JSON.parse(text) : null;
          } catch {
            data = null;
          }
          if (!res.ok) throw new Error(data?.error || "Failed to load profile");
          if (!cancelled) setUser(data);
        }
      } catch (e) {
        if (!cancelled) setAuthError(e?.message || "Auth error");
      } finally {
        if (!cancelled) setInitializing(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [API_BASE, token]);

  const login = async ({ email, password }) => {
    setAuthError("");
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }

    if (!res.ok) {
      const msg = data?.error || "Login failed";
      setAuthError(msg);
      throw new Error(msg);
    }

    if (!data?.token) {
      const msg = "Login succeeded but no token returned";
      setAuthError(msg);
      throw new Error(msg);
    }

    lsSet("token", data.token);
    lsSet("curriculate_token", data.token);
    setToken(data.token);

    // if backend returns user too, use it; otherwise fetch profile
    if (data.user) setUser(data.user);
    else await loadMe(data.token);

    return data;
  };

  const logout = () => {
    lsDel("token");
    lsDel("curriculate_token");
    setToken(null);
    setUser(null);
    setAuthError("");
  };

  // Forgot / reset password
  const requestPasswordReset = async (email) => {
    setAuthError("");
    const res = await fetch(`${API_BASE}/api/auth/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });

    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }

    if (!res.ok) {
      const msg = data?.error || "Failed to request password reset";
      setAuthError(msg);
      throw new Error(msg);
    }

    return data; // may include resetToken in dev
  };

  const resetPassword = async ({ resetToken, newPassword }) => {
    setAuthError("");
    const res = await fetch(`${API_BASE}/api/auth/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: resetToken, newPassword }),
    });

    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }

    if (!res.ok) {
      const msg = data?.error || "Failed to reset password";
      setAuthError(msg);
      throw new Error(msg);
    }

    return data;
  };

  const value = {
    user,
    token,
    isAuthenticated,
    initializing,
    authError,
    login,
    logout,
    requestPasswordReset,
    resetPassword,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within <AuthProvider>");
  }
  return ctx;
}
