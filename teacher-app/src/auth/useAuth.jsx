import React, { createContext, useContext } from "react";

// Very simple "always logged in" auth stub for development.

const AuthContext = createContext({
  user: { name: "Dev Presenter" },
  token: null,
  initializing: false,
  isAuthenticated: true,
  login: async () => ({ name: "Dev Presenter" }),
  logout: () => {},
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
  
  return (<AuthContext.Provider value={value}>{children}</AuthContext.Provider>);
}

export function useAuth() {
  return useContext(AuthContext);
}
