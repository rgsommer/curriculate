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
    } catch (e) {
      // ignore JSON / storage errors
      console.error("Error reading auth from storage", e);
    } finally {
      setInitializing(false);
    }
  }, []);

  const login = async (email, password) => {
    // Adjust this path if your backend uses a different auth prefix
    const res = await api.post("/api/auth/login", { email, password });

    // Axios: data is in res.data
    const data = (res && res.data) ? res.data : {};
    if (!data.token || !data.user) {
      throw new Error(data.error || "Login failed");
    }

    const newToken = data.token;
    const newUser = data.user;

    setToken(newToken);
    setUser(newUser);

    try {
      localStorage.setItem(TOKEN_KEY, newToken);
      localStorage.setItem(USER_KEY, JSON.stringify(newUser));
    } catch (e) {
      console.error("Error saving auth to storage", e);
    }

    return newUser;
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    } catch (e) {
      console.error("Error clearing auth from storage", e);
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

  // No JSX here on purpose – avoids any parser issues if .js isn't JSX-enabled
  return React.createElement(AuthContext.Provider, { value }, children);
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
