// teacher-app/src/main.jsx (or index.jsx)
import "./index.css";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import TeacherApp from "./TeacherApp.jsx";
import { AuthProvider } from "./auth/AuthProvider.jsx"; // whatever your provider file is

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <TeacherApp />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
