// teacher-app/src/auth/useAuth.js
import React, { createContext, useContext } from "react";

// Extremely simple "always logged in" auth stub for development.
// This keeps TeacherApp working without a real login flow yet.

const AuthContext = createContext({
  user: { name: "Dev Presenter" },
  token: null,
  initializing: false,
  isAuthenticated: true,
  login: async () => {
    // no-op login
    return { name: "Dev Presenter" };
  },
  logout: () => {
    // no-op logout
  },
});

export function AuthProvider({ children }) {
  const value = {
    user: { name: "Dev Presenter" },
    token: null,
    initializing: false,
    isAuthenticated: true,
    login: async () => ({ name: "Dev Presenter" }),
    logout: () => {},
  };

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
