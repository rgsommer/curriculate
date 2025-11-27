// teacher-app/src/auth/useAuth.js
import React, {
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";
import api from "../api/client";

// Shape of the auth context:
// {
//   user: object | null,
//   token: string | null,
//   loading: boolean,
//   isAuthenticated: boolean,
//   login(email, password),
//   logout()
// }

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(
    () => localStorage.getItem("curriculate_token") || null
  );
  const [loading, setLoading] = useState(true);

  // On mount or when token changes, try to load current user
  useEffect(() => {
    let cancelled = false;

    async function loadMe() {
      if (!token) {
        setUser(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        // Adjust this path if your backend uses a different "me" endpoint
        const res = await api.get("/api/auth/me");
        if (!cancelled) {
          setUser(res.data || null);
        }
      } catch (err) {
        console.error("Failed to load current user", err);
        if (!cancelled) {
          // Token is probably invalid → clear it
          localStorage.removeItem("curriculate_token");
          setToken(null);
          setUser(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadMe();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const login = async (email, password) => {
    // Adjust this path/shape to match your backend's login route
    const res = await api.post("/api/auth/login", { email, password });

    const newToken = res.data?.token;
    const userData = res.data?.user;

    if (newToken) {
      localStorage.setItem("curriculate_token", newToken);
    }

    setToken(newToken || null);
    setUser(userData || null);
  };

  const logout = () => {
    localStorage.removeItem("curriculate_token");
    setToken(null);
    setUser(null);
  };

  const value = {
    user,
    token,
    loading,
    isAuthenticated: !!user && !!token,
    login,
    logout,
  };

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
