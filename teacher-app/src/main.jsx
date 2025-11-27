// teacher-app/src/main.jsx (or index.jsx)
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./TeacherApp";
import { AuthProvider } from "./auth/useAuth";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>
);
