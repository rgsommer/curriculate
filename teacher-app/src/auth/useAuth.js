// teacher-app/src/auth/useAuth.js
import React, {
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";
import api from "../api/client";

const AuthContext = createContext(null);

const TOKEN_KEY = "curriculate_token";
const USER_KEY = "curriculate_user";

export function AuthProvider({ children }) {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [initializing, setInitializing] = useState(true);

  // Load from localStorage on first mount
  useEffect(() => {
    try {
      const savedToken = localStorage.getItem(TOKEN_KEY);
      const savedUser = localStorage.getItem(USER_KEY);

      if (savedToken) {
        setToken(savedToken);
      }
      if (savedUser) {
        setUser(JSON.parse(savedUser));
      }
    } catch {
      // ignore JSON / storage errors
    } finally {
      setInitializing(false);
    }
  }, []);

  const login = async (email, password) => {
    // Adjust this path if your backend uses a different auth prefix
    const res = await api.post("/api/auth/login", { email, password });

    // Axios: data is in res.data
    const data = res?.data || {};
    if (!data.token || !data.user) {
      throw new Error(data.error || "Login failed");
    }

    const { token: newToken, user: newUser } = data;

    setToken(newToken);
    setUser(newUser);

    try {
      localStorage.setItem(TOKEN_KEY, newToken);
      localStorage.setItem(USER_KEY, JSON.stringify(newUser));
    } catch {
      // ignore storage errors
    }

    return newUser;
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    } catch {
      // ignore
    }
  };

  const value = {
    user,
    token,
    initializing,
    isAuthenticated: !!token,
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
