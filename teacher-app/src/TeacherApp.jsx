// teacher-app/src/TeacherApp.jsx
import React, { useState, useEffect } from "react";
import { Routes, Route, Link, useLocation } from "react-router-dom";

import LiveSession from "./pages/LiveSession.jsx";
import HostView from "./pages/HostView.jsx";
import TaskSets from "./pages/TaskSets.jsx";
import TaskSetEditor from "./pages/TaskSetEditor.jsx";
import TeacherProfile from "./pages/TeacherProfile.jsx";
import AiTasksetGenerator from "./pages/AiTasksetGenerator.jsx";
import StationPosters from "./pages/StationPosters.jsx";
import AnalyticsOverview from "./pages/AnalyticsOverview.jsx";
import SessionAnalyticsPage from "./pages/SessionAnalyticsPage.jsx";
import MyPlanPage from "./pages/MyPlan.jsx";
import Login from "./pages/Login.jsx";

import { useAuth } from "./auth/useAuth";
import { DISALLOWED_ROOM_CODES } from "./disallowedRoomCodes.js";

function generateRoomCode() {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

  for (let attempts = 0; attempts < 1000; attempts++) {
    let code = "";
    for (let i = 0; i < 2; i++) {
      const idx = Math.floor(Math.random() * letters.length);
      code += letters[idx];
    }
    if (!DISALLOWED_ROOM_CODES.has(code)) {
      return code;
    }
  }
  return "AA";
}

function TeacherApp() {
  const [roomCode, setRoomCode] = useState(() => generateRoomCode());
  const location = useLocation();

  const { isAuthenticated, user, logout } = useAuth();

  // optional ping on unload (non-critical)
  useEffect(() => {
    if (!roomCode) return;

    const handleUnload = () => {
      try {
        navigator.sendBeacon(`/api/sessions/${roomCode}/ping`);
      } catch {
        // ignore
      }
    };

    window.addEventListener("beforeunload", handleUnload);
    return () => window.removeEventListener("beforeunload", handleUnload);
  }, [roomCode]);

  const handleNewCode = () => {
    setRoomCode(generateRoomCode());
  };

  const onLive =
    location.pathname === "/" || location.pathname.startsWith("/live");
  const onHost = location.pathname.startsWith("/host");
  const onTasksets = location.pathname.startsWith("/tasksets");
  const onReports = location.pathname.startsWith("/reports");
  const onMyPlan = location.pathname.startsWith("/my-plan");
  const onProfile = location.pathname.startsWith("/teacher/profile");
  const onAiTasksets = location.pathname.startsWith("/teacher/ai-tasksets");

  const requireAuth = (element) =>
    isAuthenticated ? element : <Login />;

  const requireRoom = (element) =>
    roomCode ? element : <EnterRoomMessage />;

  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        fontFamily:
          "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
        backgroundColor: "#f3f4f6",
      }}
    >
      {/* SIDEBAR – fixed on the left */}
      <div
        style={{
          width: 260,
          padding: 16,
          backgroundColor: "#111827",
          color: "#f9fafb",
          position: "fixed",
          left: 0,
          top: 0,
          height: "100vh",
          overflowY: "auto",
          boxShadow: "0 0 25px rgba(0,0,0,0.6)",
          zIndex: 50,
        }}
      >
        {/* App label */}
        <div
          style={{
            fontSize: "0.95rem",
            fontWeight: 700,
            marginBottom: 16,
          }}
        >
          Curriculate Teacher
        </div>

        {/* Room code box */}
        <div style={{ marginBottom: 24 }}>
          <div
            style={{
              fontSize: "0.8rem",
              fontWeight: 500,
              marginBottom: 4,
              color: "#e5e7eb",
            }}
          >
            Room Code
          </div>
          <div
            style={{
              backgroundColor: "#ffffff",
              color: "#111827",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco",
              fontSize: "1.7rem",
              padding: 12,
              borderRadius: 8,
              textAlign: "center",
              boxShadow: "0 2px 6px rgba(0,0,0,0.25)",
            }}
          >
            {roomCode}
          </div>
          <button
            onClick={handleNewCode}
            style={{
              marginTop: 10,
              width: "100%",
              fontSize: "0.85rem",
              borderRadius: 6,
              padding: "6px 10px",
              border: "1px solid rgba(156,163,175,0.9)",
              backgroundColor: "transparent",
              color: "#e5e7eb",
              cursor: "pointer",
            }}
          >
            New Code
          </button>
        </div>

        {/* Navigation links */}
        <nav>
          <NavLinkButton to="/" active={onLive}>
            Live
          </NavLinkButton>
          <NavLinkButton to="/host" active={onHost}>
            Host
          </NavLinkButton>
          <NavLinkButton to="/tasksets" active={onTasksets}>
            Task Sets
          </NavLinkButton>
          <NavLinkButton to="/reports" active={onReports}>
            Reports
          </NavLinkButton>
          <NavLinkButton to="/my-plan" active={onMyPlan}>
            My Plan
          </NavLinkButton>
          <NavLinkButton to="/teacher/profile" active={onProfile}>
            Profile
          </NavLinkButton>
          <NavLinkButton to="/teacher/ai-tasksets" active={onAiTasksets}>
            AI Task Sets
          </NavLinkButton>
        </nav>
      </div>

      {/* MAIN CONTENT – pushed to the right */}
      <main
        style={{
          flex: 1,
          marginLeft: 260,
          padding: 24,
          overflowY: "auto",
        }}
      >
        <HeaderBar
          isAuthenticated={isAuthenticated}
          user={user}
          logout={logout}
        />

        <Routes>
          {/* Live */}
          <Route
            path="/"
            element={requireAuth(
              requireRoom(<LiveSession roomCode={roomCode} />)
            )}
          />
          <Route
            path="/live"
            element={requireAuth(
              requireRoom(<LiveSession roomCode={roomCode} />)
            )}
          />

          {/* Host */}
          <Route
            path="/host"
            element={requireAuth(
              requireRoom(<HostView roomCode={roomCode} />)
            )}
          />

          {/* Tasksets */}
          <Route
            path="/tasksets"
            element={requireAuth(<TaskSets />)}
          />
          <Route
            path="/tasksets/new"
            element={requireAuth(<TaskSetEditor />)}
          />
          <Route
            path="/tasksets/:id"
            element={requireAuth(<TaskSetEditor />)}
          />

          {/* Reports / analytics */}
          <Route
            path="/reports"
            element={requireAuth(<AnalyticsOverview />)}
          />
          <Route
            path="/reports/:sessionId"
            element={requireAuth(<SessionAnalyticsPage />)}
          />

          {/* My Plan */}
          <Route
            path="/my-plan"
            element={requireAuth(<MyPlanPage />)}
          />

          {/* Teacher profile */}
          <Route
            path="/teacher/profile"
            element={requireAuth(<TeacherProfile />)}
          />

          {/* AI Taskset generator */}
          <Route
            path="/teacher/ai-tasksets"
            element={requireAuth(
              <AiTasksetGenerator roomCode={roomCode} />
            )}
          />

          {/* Station posters (linked from inside app) */}
          <Route
            path="/station-posters"
            element={requireAuth(
              requireRoom(<StationPosters roomCode={roomCode} />)
            )}
          />

          {/* Auth */}
          <Route path="/login" element={<Login />} />

          {/* Fallback */}
          <Route path="*" element={<EnterRoomMessage />} />
        </Routes>
      </main>
    </div>
  );
}

function EnterRoomMessage() {
  return (
    <div style={{ padding: 16 }}>
      <h2>No room code</h2>
      <p>
        Room code should appear in the left sidebar. If it is blank, refresh
        this page.
      </p>
    </div>
  );
}

function NavLinkButton({ to, active, children }) {
  return (
    <Link
      to={to}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        marginBottom: 6,
        padding: "6px 10px",
        borderRadius: 6,
        textDecoration: "none",
        fontSize: "0.9rem",
        backgroundColor: active ? "#0ea5e9" : "transparent",
        color: "#e5e7eb",
        cursor: "pointer",
      }}
    >
      {children}
    </Link>
  );
}

function HeaderBar({ isAuthenticated, user, logout }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: 12,
        backgroundColor: "#111827",
        color: "#f9fafb",
        borderRadius: 10,
        marginBottom: 16,
      }}
    >
      <div style={{ fontWeight: 700 }}>Curriculate Teacher</div>
      {isAuthenticated ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            fontSize: "0.9rem",
          }}
        >
          <span>{user?.email}</span>
          <button
            onClick={logout}
            style={{
              fontSize: "0.85rem",
              borderRadius: 6,
              border: "1px solid rgba(156,163,175,0.9)",
              padding: "4px 8px",
              backgroundColor: "transparent",
              color: "#e5e7eb",
              cursor: "pointer",
            }}
          >
            Logout
          </button>
        </div>
      ) : (
        <a
          href="/login"
          style={{
            fontSize: "0.85rem",
            borderRadius: 6,
            border: "1px solid rgba(156,163,175,0.9)",
            padding: "4px 8px",
            backgroundColor: "transparent",
            color: "#e5e7eb",
            cursor: "pointer",
          }}
        >
          Login
        </a>
      )}
    </div>
  );
}

export default TeacherApp;
