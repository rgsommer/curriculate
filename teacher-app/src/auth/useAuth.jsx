import React, { createContext, useContext, useEffect } from "react";  // ← Add useEffect

// Very simple "always logged in" auth stub for development.

const AuthContext = createContext({
  user: { name: "Dev Presenter" },
  token: "dev-token",  // Dummy token for dev API calls
  initializing: false,
  isAuthenticated: true,
  login: async () => ({ name: "Dev Presenter" }),
  logout: () => {},
});

export function AuthProvider({ children }) {
  const value = {
    user: { name: "Dev Presenter" },
    token: "dev-token",
    initializing: false,
    isAuthenticated: true,
    login: async () => ({ name: "Dev Presenter" }),
    logout: () => {},
  }; 
  
  // ← NEW: Save dummy token to localStorage for API calls
  useEffect(() => {
    localStorage.setItem("curriculate_token", value.token);
    return () => {
      localStorage.removeItem("curriculate_token");  // Clean up on unmount (optional for dev)
    };
  }, []);  // Runs once on mount

  return (<AuthContext.Provider value={value}>{children}</AuthContext.Provider>);
}

export function useAuth() {
  return useContext(AuthContext);
}