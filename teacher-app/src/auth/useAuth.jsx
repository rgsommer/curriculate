// teacher-app/src/auth/useAuth.jsx
import React, { createContext, useContext, useState } from "react";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [initializing, setInitializing] = useState(false);

  const login = async (credentials) => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(credentials),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data?.error || "Login failed");
    }

    // 🔑 THIS IS THE ONLY PLACE TOKEN STORAGE BELONGS
    if (!data.token) {
      throw new Error("Login succeeded but no token returned");
    }

    localStorage.setItem("token", data.token);
    setToken(data.token);
    setUser(data.user || { email: data.email });

    return data.user;
  };

  const logout = () => {
    localStorage.removeItem("token");
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        initializing,
        isAuthenticated: !!token,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
