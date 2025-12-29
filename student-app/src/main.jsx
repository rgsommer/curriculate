// student-app/src/main.jsx
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import App from "./StudentApp.jsx";
import DemoPage from "./pages/DemoPage.jsx";
import "./index.css";

// Motion permission request — must be inside a component
function MotionPermissionWrapper({ children }) {
  const [permissionAsked, setPermissionAsked] = React.useState(false);

  const requestPermission = () => {
    if (typeof DeviceMotionEvent?.requestPermission === "function" && !permissionAsked) {
      DeviceMotionEvent.requestPermission()
        .then((state) => {
          if (state === "granted") console.log("Motion granted");
        })
        .catch(console.error)
        .finally(() => setPermissionAsked(true));
    }
  };

  return (
    <div onClick={requestPermission} onTouchStart={requestPermission}>
      {children}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <MotionPermissionWrapper>
        <Routes>
          {/* Explicit demo route */}
          <Route path="/demo" element={<DemoPage />} />

          {/* Everything else → Demo */}
          <Route path="*" element={<DemoPage />} />
        </Routes>
      </MotionPermissionWrapper>
    </BrowserRouter>
  </React.StrictMode>
);
