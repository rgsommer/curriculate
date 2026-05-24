// student-app/src/main.jsx
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import App from "./StudentApp.jsx";
import DemoPage from "./pages/DemoPage.jsx";
import DemoMode from "./DemoMode.jsx";
import { ErrorBoundary } from "./components/ErrorBoundary.jsx";
import "./index.css";

// Build stamp — open the console on play.curriculate.net to see which commit is
// actually live. Defined at build time in vite.config.js (falls back in dev).
// If this commit is older than the latest on main, the deploy is serving a
// stale bundle (the real cause behind "fixes never appear").
const BUILD_COMMIT = typeof __BUILD_COMMIT__ !== "undefined" ? __BUILD_COMMIT__ : "dev";
const BUILD_TIME = typeof __BUILD_TIME__ !== "undefined" ? __BUILD_TIME__ : "dev";
try {
  // eslint-disable-next-line no-console
  console.log(`%cCurriculate student-app build ${BUILD_COMMIT} · ${BUILD_TIME}`, "color:#7c3aed;font-weight:bold");
  if (typeof window !== "undefined") window.__CURRICULATE_BUILD__ = { commit: BUILD_COMMIT, time: BUILD_TIME };
} catch { /* ignore */ }

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

            {/* Classroom practice (student-facing, points + teacher tracking) */}
            <Route path="/practice" element={<DemoMode source="classroom" />} />

            {/* Unknown routes -> main */}
            <Route path="*" element={<App />} />
          </Routes>
        </MotionPermissionWrapper>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);
