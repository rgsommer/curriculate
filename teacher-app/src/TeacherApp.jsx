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
  return "AA"; // ultra-fallback
}

function TeacherApp() {
  const [roomCode, setRoomCode] = useState(() => generateRoomCode());
  const location = useLocation();
  const { isAuthenticated, user, logout } = useAuth();

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
    <div className="flex min-h-screen font-sans bg-gray-100">
      {/* Sidebar — now fixed, no overlay */}
      <div className="w-64 p-4 bg-gray-800 text-white h-screen fixed overflow-y-auto z-50 shadow-2xl">
        {/* Room Code Section */}
        <div className="mb-8">
          <div className="text-sm font-medium mb-2">Room Code</div>
          <div className="bg-white text-gray-900 font-mono text-2xl p-3 rounded-lg text-center shadow">
            {roomCode}
          </div>
          <button
            onClick={handleNewCode}
            className="mt-3 w-full text-sm border px-3 py-2 rounded hover:bg-gray-700 transition"
          >
            New Code
          </button>
        </div>

        {/* Nav Links */}
        <nav className="space-y-3">
          <NavLinkButton to="/" active={onLive}>Live</NavLinkButton>
          <NavLinkButton to="/host" active={onHost}>Host</NavLinkButton>
          <NavLinkButton to="/tasksets" active={onTasksets}>Task Sets</NavLinkButton>
          <NavLinkButton to="/reports" active={onReports}>Reports</NavLinkButton>
          <NavLinkButton to="/my-plan" active={onMyPlan}>My Plan</NavLinkButton>
          <NavLinkButton to="/teacher/profile" active={onProfile}>Profile</NavLinkButton>
          <NavLinkButton to="/teacher/ai-tasksets" active={onAiTasksets}>AI Task Sets</NavLinkButton>
        </nav>
      </div>

      {/* Main Content — flexes right, no overlap */}
      <main className="flex-1 ml-64 p-8 overflow-y-auto">
        <HeaderBar isAuthenticated={isAuthenticated} user={user} logout={logout} />
        <Routes>
          {/* ... all your routes unchanged ... */}
        </Routes>
      </main>
    </div>
  );
}

useEffect(() => {
  const handleUnload = () => {
    navigator.sendBeacon(`/api/sessions/${roomCode}/ping`);
  };
  window.addEventListener("beforeunload", handleUnload);
  return () => window.removeEventListener("beforeunload", handleUnload);
}, [roomCode]);

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

function HeaderBar({ isAuthenticated, user, logout }) {
  return (
    <div className="flex justify-between items-center p-3 bg-gray-800 text-white">
      <div className="font-bold">Curriculate Teacher</div>

      {isAuthenticated ? (
        <div className="flex items-center gap-4">
          <span className="text-sm">{user?.email}</span>
          <button
            onClick={logout}
            className="text-sm border px-2 py-1 rounded hover:bg-gray-700"
          >
            Logout
          </button>
        </div>
      ) : (
        <a
          href="/login"
          className="text-sm border px-2 py-1 rounded hover:bg-gray-700"
        >
          Login
        </a>
      )}
    </div>
  );
}

export default TeacherApp;
