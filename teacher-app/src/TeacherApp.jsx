// teacher-app/src/TeacherApp.jsx
import React, { useState } from "react";
import { Routes, Route, Link, Navigate, useLocation } from "react-router-dom";

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
  return "AA"; // ultra-fallback
}

function TeacherApp() {
  const [roomCode, setRoomCode] = useState(() => generateRoomCode());
  const location = useLocation();

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

  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        fontFamily: "system-ui, -apple-system, 'Segoe UI'",
      }}
    >
      {/* SIDEBAR */}
      <aside
        style={{
          width: 220,
          background: "#18233a",
          color: "#fff",
          padding: 16,
        }}
      >
        <h2 style={{ marginTop: 0, marginBottom: 20 }}>Curriculate</h2>

        {/* Room code display */}
        <div style={{ marginBottom: 24 }}>
          <div
            style={{
              fontSize: "0.8rem",
              marginBottom: 4,
              color: "#cbd5f5",
            }}
          >
            Room code
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <div
              style={{
                minWidth: 70,
                padding: "6px 10px",
                borderRadius: 6,
                border: "1px solid rgba(148,163,184,0.7)",
                background: "#0b1120",
                textAlign: "center",
                fontWeight: 700,
                letterSpacing: 2,
                fontSize: "1.1rem",
              }}
            >
              {roomCode}
            </div>
            <button
              type="button"
              onClick={handleNewCode}
              style={{
                padding: "4px 8px",
                borderRadius: 6,
                border: "1px solid rgba(148,163,184,0.8)",
                background: "transparent",
                color: "#e5e7eb",
                fontSize: "0.75rem",
                cursor: "pointer",
              }}
              title="Generate a new room code"
            >
              New
            </button>
          </div>
          <p
            style={{
              marginTop: 6,
              fontSize: "0.75rem",
              color: "#9ca3af",
            }}
          >
            Students enter this code on their devices to join.
          </p>
        </div>

        {/* Nav */}
        <div style={{ marginTop: 16 }}>
          <NavLinkButton to="/live" active={onLive}>
            Live session
          </NavLinkButton>
          <NavLinkButton to="/host" active={onHost}>
            Host / projector
          </NavLinkButton>
          <NavLinkButton to="/tasksets" active={onTasksets}>
            Task sets
          </NavLinkButton>
          <NavLinkButton to="/reports" active={onReports}>
            Reports
          </NavLinkButton>
          <NavLinkButton to="/my-plan" active={onMyPlan}>
            My plan
          </NavLinkButton>

          {/* Teacher tools section */}
          <div
            style={{
              marginTop: 12,
              marginBottom: 4,
              fontSize: "0.7rem",
              textTransform: "uppercase",
              letterSpacing: 1,
              color: "#9ca3af",
            }}
          >
            Teacher tools
          </div>
          <NavLinkButton to="/teacher/profile" active={onProfile}>
            Presenter profile
          </NavLinkButton>
          <NavLinkButton to="/teacher/ai-tasksets" active={onAiTasksets}>
            AI task set generator
          </NavLinkButton>
        </div>
      </aside>

      {/* MAIN AREA */}
      <main
        style={{
          flex: 1,
          background: "#f8fafc",
          padding: 32,
        }}
      >
        <Routes>
          {/* Redirect base path to /live */}
          <Route path="/" element={<Navigate to="/live" replace />} />

          {/* Live / Room view */}
          <Route
            path="/live"
            element={
              roomCode ? (
                <LiveSession roomCode={roomCode} />
              ) : (
                <EnterRoomMessage />
              )
            }
          />

          {/* Host / Projector */}
          <Route
            path="/host"
            element={
              roomCode ? (
                <HostView roomCode={roomCode} />
              ) : (
                <EnterRoomMessage />
              )
            }
          />

          {/* Task sets list + editor */}
          <Route path="/tasksets" element={<TaskSets />} />
          <Route path="/tasksets/:id" element={<TaskSetEditor />} />

          {/* Reports (analytics) */}
          <Route path="/reports" element={<AnalyticsOverview />} />
          <Route
            path="/reports/:sessionId"
            element={<SessionAnalyticsPage />}
          />

          {/* My Plan */}
          <Route path="/my-plan" element={<MyPlanPage />} />

          {/* Presenter profile */}
          <Route path="/teacher/profile" element={<TeacherProfile />} />

          {/* AI TaskSet generator */}
          <Route
            path="/teacher/ai-tasksets"
            element={<AiTasksetGenerator />}
          />

          {/* Station posters */}
          <Route path="/station-posters" element={<StationPosters />} />
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
        marginBottom: 8,
        padding: "6px 10px",
        borderRadius: 6,
        background: active ? "#0ea5e9" : "transparent",
        color: "#fff",
        cursor: "pointer",
        textDecoration: "none",
        fontSize: "0.9rem",
      }}
    >
      {children}
    </Link>
  );
}

export default TeacherApp;
