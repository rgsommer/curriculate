// student-app/src/main.jsx
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import App from "./StudentApp.jsx";
import DemoPage from "./pages/DemoPage.jsx";
import DemoMode from "./DemoMode.jsx";
import { ErrorBoundary } from "./components/ErrorBoundary.jsx";
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
    <ErrorBoundary>
      <BrowserRouter>
        <MotionPermissionWrapper>
          <Routes>
            {/* Main student flow */}
            <Route path="/" element={<App />} />

            {/* Demo page (developer) */}
            <Route path="/demo" element={<DemoPage />} />

            {/* Conference demo (visitor-facing) */}
            <Route path="/conference" element={<DemoMode />} />

            {/* Unknown routes -> main */}
            <Route path="*" element={<App />} />
          </Routes>
        </MotionPermissionWrapper>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);
