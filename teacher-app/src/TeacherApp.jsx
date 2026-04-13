// teacher-app/src/TeacherApp.jsx
import React, { useState, useEffect, useMemo, useRef } from "react";
import { Routes, Route, Link, useLocation } from "react-router-dom";

import LiveSession from "./pages/LiveSession.jsx";
import HostView from "./pages/HostView.jsx";
import TaskSets from "./pages/TaskSets.jsx";
import TaskSetEditor from "./pages/TaskSetEditor.jsx";
import TeacherProfile from "./pages/TeacherProfile.jsx";
import AiTasksetGenerator from "./pages/AiTasksetGenerator.jsx";
import Signup from "./pages/Signup.jsx";

import StationPosters from "./pages/StationPosters.jsx";
import AnalyticsOverview from "./pages/AnalyticsOverview.jsx";
import SessionAnalyticsPage from "./pages/SessionAnalyticsPage.jsx";
import MyPlanPage from "./pages/MyPlan.jsx";
import Login from "./pages/Login.jsx";
import { apiFetch, apiFetchJson } from "./api/apiFetch";

import { useAuth } from "./auth/useAuth";
import { DISALLOWED_ROOM_CODES } from "./disallowedRoomCodes.js";

import { socket } from "./socket"; // adjust path if needed
import SharedLaunch from "./pages/SharedLaunch.jsx";

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

const ENTRY_KEY = "curriculate.teacherApp.entry.ok";
const IS_PROD = import.meta?.env?.PROD === true;

function getStoredAuthToken() {
  try {
    return localStorage.getItem("token") || "";
  } catch {
    return "";
  }
}

function entryKeyForUser(user) {
  const id = user?.userId || user?._id || user?.id || user?.email || "anon";
  return `${ENTRY_KEY}:${id}`;
}


/**
 * NOTE:
 * - This file preserves your structure and routes.
 * - EntryGate is upgraded to "claim or verify + welcome/plan screen".
 * - Sidebar shows an Admin link only for admin users.
 * - Button/input styling is restored to a clean, rounded blue UI.
 */
function TeacherApp() {
  const routeLocation = useLocation();
  const location = routeLocation; // optional, keeps your existing uses
  const { isAuthenticated, user, logout } = useAuth();
  const [roomCode, setRoomCode] = useState(() => {
    const override = localStorage.getItem("curriculateRoomCodeOverride");
    if (override && override.trim()) return override.trim().toUpperCase();
    // Check for an active room code persisted from another tab/window
    const active = localStorage.getItem("curriculate.activeRoomCode");
    if (active && active.trim()) return active.trim().toUpperCase();
    const fresh = generateRoomCode();
    try { localStorage.setItem("curriculate.activeRoomCode", fresh); } catch {}
    return fresh;
  });

  // Persist room code to localStorage so Host + Live tabs share it
  useEffect(() => {
    if (!roomCode) return;
    try { localStorage.setItem("curriculate.activeRoomCode", roomCode); } catch {}
    // Listen for changes from other tabs
    const onStorage = (e) => {
      if (e.key === "curriculate.activeRoomCode" && e.newValue) {
        const code = e.newValue.trim().toUpperCase();
        if (code && code !== roomCode) setRoomCode(code);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [roomCode]);

  const isSharedRoute = routeLocation.pathname.startsWith("/shared/");

  const isAuthRoute =
    routeLocation.pathname === "/login" ||
    routeLocation.pathname === "/signup" ||
    routeLocation.pathname.startsWith("/reset-password");

  const isHostKioskRoute = routeLocation.pathname === "/host-kiosk";

  // If we're on auth routes, render ONLY the auth page (no sidebar/header)
  if (isAuthRoute) {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      {/* later */}
      {/* <Route path="/reset-password" element={<ResetPassword />} /> */}
      <Route path="*" element={<Login />} />
    </Routes>
  );
}

  if (isHostKioskRoute) {
    const requireAuth = (element) => (isAuthenticated ? element : <Login />);
    const requireRoom = (element) => (roomCode ? element : <EnterRoomMessage />);

    return (
      <Routes>
        <Route
          path="/host-kiosk"
          element={requireAuth(requireRoom(<HostView roomCode={roomCode} />))}
        />
        <Route path="*" element={requireAuth(requireRoom(<HostView roomCode={roomCode} />))} />
      </Routes>
    );
  }

  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" ? window.innerWidth < 768 : false
  );

  const isAdmin = useMemo(() => {
    const roles = Array.isArray(user?.roles) ? user.roles : [];
    return (
      user?.isAdmin === true ||
      user?.role === "admin" ||
      user?.userType === "admin" ||
      roles.includes("admin")
    );
  }, [user]);

  if (!import.meta.env.PROD) {
    console.log("AUTH user:", user);
    console.log("isAdmin:", isAdmin);
  }

  const [entryOk, setEntryOk] = useState(false);

  useEffect(() => {
    if (isAuthenticated && isAdmin) {
      setEntryOk(true);
      try { localStorage.setItem(entryKeyForUser(user), "1"); } catch {}
    }
  }, [isAuthenticated, isAdmin, user]);

  // Ensure room exists + keepalive for whole session
  useEffect(() => {
    if (!isAuthenticated || !entryOk) return;

    const code = (roomCode || "").trim().toUpperCase();
    if (!code) return;

    const ensureRoom = () => {
      // Only attempt when online; prevents "internet disconnected" spam
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      socket.emit("teacher:createRoom", { roomCode: code });
    };

    const handleOnline = () => {
      // On reconnect to internet, try to (re)assert room existence
      ensureRoom();
      // Socket might have been disconnected; if so, try to connect
      try {
        if (!socket.connected && typeof socket.connect === "function") socket.connect();
      } catch {}
    };

    const handleOffline = () => {
      // Optional: reduce noise + avoid wasted polling while offline
      try {
        if (socket.connected && typeof socket.disconnect === "function") socket.disconnect();
      } catch {}
    };

    // create/claim immediately + after reconnects
    if (socket.connected) ensureRoom();
    socket.on("connect", ensureRoom);

    // keep it alive for the whole session, but only when online
    const t = setInterval(() => {
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      socket.emit("teacher:keepalive", { roomCode: code });
    }, 5000);

    // browser online/offline listeners
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      clearInterval(t);
      socket.off("connect", ensureRoom);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [roomCode, isAuthenticated, entryOk]);

  // Ensure room exists + keepalive for whole session
  useEffect(() => {
    if (!isAuthenticated || !entryOk) return;

    const code = (roomCode || "").trim().toUpperCase();
    if (!code) return;

    const ensureRoom = () => {
      socket.emit("teacher:createRoom", { roomCode: code });
    };

    // create/claim immediately + after reconnects
    if (socket.connected) ensureRoom();
    socket.on("connect", ensureRoom);

    // keep it alive for the whole session (1 hour+)
    const t = setInterval(() => {
      socket.emit("teacher:keepalive", { roomCode: code });
    }, 5000);

    return () => {
      clearInterval(t);
      socket.off("connect", ensureRoom);
    };
  }, [roomCode, isAuthenticated, entryOk]);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

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

  // Clear room code override when navigating away from /live
  useEffect(() => {
    if (location.pathname === "/live") {
      const ov = localStorage.getItem("curriculateRoomCodeOverride");
      if (ov) localStorage.removeItem("curriculateRoomCodeOverride");
    }
  }, [location.pathname]);


  const handleNewCode = () => {
    setRoomCode(generateRoomCode());
  };

  const onLive = routeLocation.pathname === "/" || routeLocation.pathname.startsWith("/live");
  const onHost = routeLocation.pathname.startsWith("/host");
  const onTasksets = routeLocation.pathname.startsWith("/tasksets");
  const onReports = routeLocation.pathname.startsWith("/reports");
  const onMyPlan = routeLocation.pathname.startsWith("/my-plan");
  const onProfile = location.pathname.startsWith("/teacher/profile");
  const onAiTasksets = location.pathname.startsWith("/teacher/ai-tasksets");
  const onAdmin = location.pathname.startsWith("/admin");

  const requireAuth = (element) => (isAuthenticated ? element : <Login />);

  const requireAdmin = (element) =>
  isAuthenticated ? (isAdmin ? element : <EnterRoomMessage />) : <Login />;

  const clearEntryOk = () => {
    try {
      localStorage.removeItem(ENTRY_KEY);
      localStorage.removeItem(entryKeyForUser(user));
    } catch {}
    setEntryOk(false);
  };

  const logoutWithClear = () => {
    clearEntryOk();
    logout();
  };

  // Shared launch route
  if (isSharedRoute) {
    return (
      <Routes>
        <Route path="/shared/:token" element={<SharedLaunch />} />
      </Routes>
    );
  }

  // After auth is established, require entry code unless already verified
  if (isAuthenticated && !entryOk) {
    return (
      <EntryGateServer
        user={user}
        onPass={() => {
          try {
            const v = user?.email ? `1:${user.email}` : "1";
            localStorage.setItem(entryKeyForUser(user), "1");
            localStorage.removeItem(ENTRY_KEY); // remove legacy global flag
          } catch {}
          setEntryOk(true);
        }}
        onLogout={logoutWithClear}
      />
    );
  }

  const requireRoom = (element) => (roomCode ? element : <EnterRoomMessage />);

  const sidebarWidth = isMobile ? "18vw" : 220; // ~1/5 of phone, narrower desktop

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
          width: sidebarWidth,
          minWidth: isMobile ? 80 : 180,
          maxWidth: isMobile ? "22vw" : 260,
          padding: isMobile ? 10 : 16,
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
          Curriculate Presenter
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
              borderRadius: 10,
              padding: "9px 10px",
              border: "1px solid rgba(156,163,175,0.5)",
              backgroundColor: "rgba(255,255,255,0.06)",
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
            Generate A New Set
          </NavLinkButton>
          <NavLinkButton to="/teacher/ai-tasksets?mode=party" active={false}>
            🎉 Party Games
          </NavLinkButton>
          <NavLinkButton to="/teacher/ai-tasksets?mode=event" active={false}>
            🏢 Event Games
          </NavLinkButton>

          {/* Admin link (only for admins) */}
          {isAdmin && (
            <NavLinkButton to="/admin" active={onAdmin}>
              Admin
            </NavLinkButton>
          )}
        </nav>
      </div>

      {/* MAIN CONTENT – pushed to the right */}
      <main
        style={{
          flex: 1,
          marginLeft: sidebarWidth,
          padding: isMobile ? 16 : 24,
          overflowY: "auto",
        }}
      >
        <HeaderBar
          isAuthenticated={isAuthenticated}
          user={user}
          logoutWithClear={logoutWithClear}
          isAdmin={isAdmin}
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
            element={requireAuth(requireRoom(<HostView roomCode={roomCode} />))}
          />

          {/* Tasksets */}
          <Route path="/tasksets" element={requireAuth(<TaskSets />)} />
          <Route path="/tasksets/new" element={requireAuth(<TaskSetEditor />)} />
          <Route path="/tasksets/:id" element={requireAuth(<TaskSetEditor />)} />

          {/* Reports / analytics */}
          <Route path="/reports" element={requireAuth(<AnalyticsOverview />)} />
          <Route
            path="/reports/:sessionId"
            element={requireAuth(<SessionAnalyticsPage />)}
          />

          {/* My Plan */}
          <Route path="/my-plan" element={requireAuth(<MyPlanPage />)} />

          {/* Teacher profile */}
          <Route path="/teacher/profile" element={requireAuth(<TeacherProfile />)} />

          {/* AI Taskset generator */}
          <Route
            path="/teacher/ai-tasksets"
            element={requireAuth(<AiTasksetGenerator roomCode={roomCode} />)}
          />

          {/* Station posters (linked from inside app) */}
          <Route
            path="/station-posters"
            element={requireAuth(requireRoom(<StationPosters roomCode={roomCode} />))}
          />

          {/* Admin */}
          <Route path="/admin" element={requireAdmin(<AdminPage isAdmin={isAdmin} />)} />
          <Route path="/admin/access-codes" element={requireAdmin(<AdminPage isAdmin={isAdmin} />)} />
          
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
        Room code should appear in the left sidebar. If it is blank, refresh this
        page.
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
        padding: "8px 10px",
        borderRadius: 10,
        textDecoration: "none",
        fontSize: "0.9rem",
        backgroundColor: active ? "#0ea5e9" : "transparent",
        color: "#e5e7eb",
        cursor: "pointer",
        border: active ? "1px solid rgba(255,255,255,0.18)" : "1px solid transparent",
      }}
    >
      {children}
    </Link>
  );
}

function HeaderBar({ isAuthenticated, user, logoutWithClear, isAdmin }) {
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
      <div style={{ fontWeight: 700 }}>Curriculate Presenter</div>
      {isAuthenticated ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            fontSize: "0.9rem",
          }}
        >
          <span style={{ opacity: 0.9 }}>{user?.email}</span>
          {isAdmin && (
            <Link to="/admin" style={{ ...ui.buttonGhost, textDecoration: "none", display: "inline-block" }}>
              Admin
            </Link>
          )}
          <button
            onClick={logoutWithClear}
            style={ui.buttonGhost}
          >
            Logout
          </button>
        </div>
      ) : (
        <a href="/login" style={ui.buttonGhost}>
          Login
        </a>
      )}
    </div>
  );
}

function MaskOnHover({ value }) {
  const [hover, setHover] = useState(false);
  const masked = "•".repeat(Math.min(16, String(value || "").length || 8));

  return (
    <span
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
      title="Hover to reveal"
    >
      {hover ? value : masked}
    </span>
  );
}

/**
 * Upgraded Entry Gate:
 * - First tries verify endpoint (returning teachers)
 * - If verify fails, tries claim endpoint (new teachers / first-time setup)
 * - Shows a Welcome/Plan screen after claim, then Continue into app
 */
function EntryGateServer({ user, onPass, onLogout }) {
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const [stage, setStage] = useState("enter"); // enter | welcome
  const [welcome, setWelcome] = useState(null);

  const normalize = (v) => (v || "").trim().toUpperCase();

  const submit = async (e) => {
    e.preventDefault();
    setErr("");

    const trimmed = normalize(code);
    if (!trimmed) {
      setErr("Please enter your access code.");
      return;
    }
    if (!/^[A-Z0-9_-]+$/i.test(trimmed)) {
      setErr("Letters and numbers only.");
      return;
    }

    setBusy(true);
    try {
      // 1) Try verify (returning teacher)
      const verifyRes = await apiFetch("/api/teacher/verify-entry-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: trimmed }),
      });
      let verifyData = null;
      try {
        verifyData = await verifyRes.json();
      } catch {
        verifyData = null;
      }

      if (verifyRes.ok && verifyData?.ok) {
        onPass();
        return;
      }

      // 2) If verify fails, try claim (new teacher)
      const claimRes = await apiFetch("/api/teacher/claim-access-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: trimmed }),
      });

      const claimData = await claimRes.json().catch(() => null);

      if (!claimRes.ok || !claimData?.ok) {
        setErr(
          claimData?.error ||
            verifyData?.error ||
            "Incorrect or unavailable code."
        );
        return;
      }

      // Welcome screen (plan details)
      setWelcome({
        teacherEmail: user?.email || "",
        planTier: claimData?.plan?.tier || claimData?.planTier || "FREE",
        planLabel: claimData?.plan?.label || null,
        planDetails: claimData?.plan || null,
        welcomeMessage:
          claimData?.welcome?.message ||
          claimData?.message ||
          "Welcome to Curriculate!",
      });
      setStage("welcome");
    } catch (e) {
      console.error("Admin create code failed:", e);
      setErr("Network error");
    } finally {
      setBusy(false);
    }
  };

  const continueIntoApp = () => {
    onPass();
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "radial-gradient(1200px 600px at 50% 20%, #1e293b 0%, #0b1220 55%, #020617 100%)",
        color: "#f9fafb",
        padding: 16,
        boxSizing: "border-box",
      }}
    >
      <div style={{ width: "100%", maxWidth: 420 }}>
        <div
          style={{
            textAlign: "center",
            marginBottom: 14,
            opacity: 0.95,
            fontWeight: 800,
            letterSpacing: 0.2,
          }}
        >
          Curriculate Presenter
        </div>

        {stage === "enter" ? (
          <form
            onSubmit={submit}
            style={{
              width: "100%",
              padding: 20,
              borderRadius: 16,
              background: "rgba(2,6,23,0.92)",
              boxSizing: "border-box",
              border: "1px solid rgba(148,163,184,0.18)",
              boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
            }}
          >
            <h2 style={{ marginBottom: 8, fontSize: "1.25rem" }}>
              Teacher Access
            </h2>
            <p style={{ opacity: 0.78, marginBottom: 14, lineHeight: 1.4 }}>
              Enter your Curriculate access code.
            </p>

            <label style={ui.label}>Access code</label>
            <input
              autoFocus
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                setErr("");
              }}
              placeholder="Enter your access code"
              style={ui.input}
            />

            {err && (
              <div style={{ color: "#fca5a5", marginTop: 10, fontWeight: 600 }}>
                {err}
              </div>
            )}

            <button disabled={busy} style={{ ...ui.buttonPrimary, marginTop: 14, width: "100%" }}>
              {busy ? "Checking…" : "Enter"}
            </button>

            <button
              type="button"
              onClick={onLogout}
              style={{ ...ui.buttonGhost, marginTop: 10, width: "100%" }}
            >
              Logout
            </button>

            <div style={{ marginTop: 12, fontSize: "0.85rem", opacity: 0.7 }}>
              Signed in as: <span style={{ opacity: 0.95 }}>{user?.email}</span>
            </div>
          </form>
        ) : (
          <div
            style={{
              width: "100%",
              padding: 20,
              borderRadius: 16,
              background: "rgba(2,6,23,0.92)",
              boxSizing: "border-box",
              border: "1px solid rgba(148,163,184,0.18)",
              boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
            }}
          >
            <h2 style={{ marginBottom: 8, fontSize: "1.25rem" }}>
              Welcome!
            </h2>
            <p style={{ opacity: 0.85, marginBottom: 14, lineHeight: 1.4 }}>
              {welcome?.welcomeMessage}
            </p>

            <div
              style={{
                background: "rgba(15,23,42,0.8)",
                border: "1px solid rgba(148,163,184,0.18)",
                borderRadius: 14,
                padding: 14,
                marginBottom: 14,
              }}
            >
              <div style={{ fontWeight: 800, marginBottom: 6 }}>
                Your plan:{" "}
                <span style={{ color: "#7dd3fc" }}>
                  {welcome?.planLabel || welcome?.planTier || "FREE"}
                </span>
              </div>

              <PlanDetails plan={welcome?.planDetails} fallbackTier={welcome?.planTier} />
            </div>

            <button
              onClick={continueIntoApp}
              style={{ ...ui.buttonPrimary, width: "100%" }}
            >
              Continue
            </button>

            <button
              type="button"
              onClick={onLogout}
              style={{ ...ui.buttonGhost, marginTop: 10, width: "100%" }}
            >
              Logout
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function PlanDetails({ plan, fallbackTier }) {
  // Accepts whatever your backend returns; shows a clean fallback if fields are missing.
  const tier = (plan?.tier || fallbackTier || "FREE").toString().toUpperCase();

  const bullets =
    Array.isArray(plan?.bullets) ? plan.bullets :
    Array.isArray(plan?.features) ? plan.features :
    null;

  const limits = plan?.limits || null;

  return (
    <div style={{ fontSize: "0.92rem", lineHeight: 1.45, opacity: 0.92 }}>
      {plan?.description ? (
        <div style={{ marginBottom: 8 }}>{plan.description}</div>
      ) : (
        <div style={{ marginBottom: 8 }}>
          You're on the <b>{tier}</b> tier. You can change or upgrade later in{" "}
          <b>My Plan</b>.
        </div>
      )}

      {limits && (
        <div style={{ marginBottom: 10, opacity: 0.9 }}>
          {Object.entries(limits).slice(0, 6).map(([k, v]) => (
            <div key={k}>
              <span style={{ opacity: 0.8 }}>{k}:</span>{" "}
              <span style={{ fontWeight: 700 }}>{String(v)}</span>
            </div>
          ))}
        </div>
      )}

      {bullets && bullets.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {bullets.slice(0, 6).map((b, idx) => (
            <li key={idx} style={{ marginBottom: 4 }}>
              {String(b)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

async function fetchJsonSafe(url, options = {}) {
  try {
    const res = await fetch(url, { ...options, credentials: options.credentials ?? "include" });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch {}

    if (!res.ok) {
      return { ok: false, error: json?.error || json?.message || `HTTP ${res.status}` };
    }
    return json ?? { ok: false, error: "No JSON response" };
  } catch (e) {
    return { ok: false, error: e?.message || "Network error" };
  }
}

async function fetchJsonAbs(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    // keep cookies if any; safe even if unused
    credentials: options.credentials ?? "include",
  });

  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}

  if (!res.ok) {
    const msg = json?.error || json?.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json;
}

/**
 * Inline Admin page so you don't have to create a new file.
 * Uses:
 * - GET  /api/admin/access-codes
 * - POST /api/admin/access-codes
 */
function AdminPage({ isAdmin = false }) {
  // UI helpers used by the email templates section
  const input = {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(15,23,42,0.12)",
    background: "#ffffff",
    color: "#0f172a",
    outline: "none",
    boxSizing: "border-box",
    fontSize: "0.95rem",
  };

  const [demoOk, setDemoOk] = useState("");
  const [demoProgress, setDemoProgress] = useState(0); // 0..1
  const progTimerRef = useRef(null);


  function startFakeProgress() {
  // smooth-ish progress up to 90% while waiting
  setDemoProgress(0.08);
  if (progTimerRef.current) clearInterval(progTimerRef.current);

  progTimerRef.current = setInterval(() => {
    setDemoProgress((p) => {
      const next = p + (0.02 * (1 - p)); // ease
      return Math.min(0.9, next);
    });
  }, 250);
}

  function stopFakeProgress(finalValue = 1) {
    if (progTimerRef.current) {
      clearInterval(progTimerRef.current);
      progTimerRef.current = null;
    }
    setDemoProgress(finalValue);
    // reset back to 0 after a moment so it's ready for next click
    window.setTimeout(() => setDemoProgress(0), 900);
  }

  function bucketReason(err) {
    const s = String(err || "").toLowerCase();
    if (!s) return "unknown";
    if (s.includes("schema") || s.includes("invalid")) return "schema-invalid";
    if (s.includes("timeout") || s.includes("budget")) return "timeout/budget";
    if (s.includes("500")) return "server-500";
    if (s.includes("fetch") || s.includes("network")) return "network";
    if (s.includes("stream")) return "stream";
    return "other";
  }

  const pill = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid rgba(15,23,42,0.12)",
    background: "rgba(15,23,42,0.04)",
    fontSize: 12,
    fontWeight: 900,
    color: "#0f172a",
    whiteSpace: "nowrap",
  };
  // -------------------------
  // Demo taskset (system-admin only)
  // -------------------------
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoErr, setDemoErr] = useState("");
  const [demoInfo, setDemoInfo] = useState(null);
  const [demoDone, setDemoDone] = useState(0);
  const [demoTotal, setDemoTotal] = useState(0);
  const [demoCurrentTask, setDemoCurrentTask] = useState("");
  const sseRef = useRef(null);

  // -------------------------
  // Stress test (Admin): repeat demo taskset generation N times
  // Uses the same SSE stream endpoint as "Regenerate demo taskset"
  // -------------------------
  const [stressRuns, setStressRuns] = useState(50);
  const [stressBudgetMs, setStressBudgetMs] = useState(90000);
  const [stressAllowPlaceholders, setStressAllowPlaceholders] = useState(true);
  const [stressRunning, setStressRunning] = useState(false);
  const [stressDone, setStressDone] = useState(0);
  const [stressOk, setStressOk] = useState(0);
  const [stressFail, setStressFail] = useState(0);
  const stressStopRef = useRef(false);
  const [stressLastRunId, setStressLastRunId] = useState(null);
  const [stressFailures, setStressFailures] = useState([]); // last run only (trimmed)
  const [stressReasonCounts, setStressReasonCounts] = useState({});
  
  // Normalize API base to avoid malformed URLs like:
  // https://api.curriculate.nethttps//api.curriculate.net/...
    const API_BASE = useMemo(() => {
    let raw = String(
      import.meta?.env?.VITE_API_BASE_URL || "https://api.curriculate.net"
    ).trim();

    // Fix common missing-colon typos anywhere in the string
    raw = raw.replace(/https\/\//gi, "https://").replace(/http\/\//gi, "http://");

    // If someone accidentally duplicated the base, keep only the first scheme+host
    // Example: https://api.curriculate.nethttps://api.curriculate.net/...
    const m = raw.match(/^(https?:\/\/[^/]+)/i);
    const base = m ? m[1] : "https://api.curriculate.net";

    return base.replace(/\/+$/, "");
  }, []);

  
  // Canonical key used by backend demo taskset store
  const DEMO_TASKSET_KEY = "demoTaskset:v1";
const runOneStress = () =>
    new Promise((resolve) => {
      const startedAt = Date.now();
      const t0 = performance.now();

      const done = (payload) => {
        const ms = Math.round(performance.now() - t0);
        resolve({ ...payload, ms, startedAt });
      };
      const qs = new URLSearchParams();

        const token = getStoredAuthToken();

        if (token) qs.set("token", token);

        
    qs.set("key", DEMO_TASKSET_KEY);
// cache-bust so browser never reuses a cached GET
        qs.set("_t", String(Date.now()));

      qs.set("allowPlaceholders", String(!!stressAllowPlaceholders));
      qs.set("budgetMs", String(Number(stressBudgetMs) || 90000));

      const es = new EventSource(`${API_BASE}/api/demo/taskset/stream?${qs.toString()}`);

      // Poll status as a backup in case SSE events don't arrive
      const statusPollMs = 1500;
      const poll = async () => {
        try {
          const qs2 = new URLSearchParams();
          const token2 = getStoredAuthToken();
          if (token2) qs2.set("token", token2);

                    
            qs2.set("key", DEMO_TASKSET_KEY);

          const st = await fetchJsonAbs(`${API_BASE}/api/demo/taskset/status?${qs2.toString()}`);
if (st?.ok && st.exists) {
            // Optional: surface taskCount in UI somewhere if you want
            // If generation finished, taskCount should match eligibleTypes length
            // You can stop polling once it's non-zero and updatedAt is present
            if ((st.taskCount || 0) > 0 && st.updatedAt) {
              // You could stop polling here, OR just let SSE "done" stop it
              return true;
            }
          }
        } catch {}
        return false;
      };

      let pollTimer = window.setInterval(poll, statusPollMs);

      const cleanup = () => {
        try { es.close(); } catch {}
        setDemoCurrentTask("");
        if (pollTimer) { window.clearInterval(pollTimer); pollTimer = null; }
      };

      es.addEventListener("done", (ev) => {
        cleanup();
        let data = {};
        try { data = JSON.parse(ev.data || "{}"); } catch {}
        if (data.ok === false) {
          const failed = Array.isArray(data.failedTypes) ? data.failedTypes : [];
          done({ ok: false, phase: "done", error: `${failed.length} type(s) failed: ${failed.join(", ")}`, failedTypes: failed });
        } else {
          done({ ok: true, phase: "done" });
        }
      });

      es.addEventListener("fatal", (ev) => {
        cleanup();
        let msg = "Stream error";
        try { const data = JSON.parse(ev.data || "{}"); msg = data?.error ? String(data.error) : msg; } catch {}
        done({ ok: false, phase: "fatal", error: msg });
      });

      es.addEventListener("error", (ev) => {
        cleanup();
        let msg = "Stream error";
        try { const data = JSON.parse(ev.data || "{}"); msg = data?.error ? String(data.error) : msg; } catch {}
        done({ ok: false, phase: "sse-error", error: msg });
      });

      es.onerror = async () => {
        const ok = await poll();
        cleanup();

        if (ok) {
          if (isAdmin) await loadDemoInfo();
          setDemoOk("Regenerated ✓ (verified by status)");
          window.setTimeout(() => setDemoOk(""), 2500);
          done({ ok: true, phase: "poll-verified" });
        } else {
          setDemoErr("Stream connection lost (status did not confirm completion).");
          done({ ok: false, phase: "stream-lost", error: "Stream connection lost" });
        }
      };
    });

  const startStress = async () => {
    if (!isAdmin || stressRunning) return;
    setStressRunning(true);
    stressStopRef.current = false;
    setStressDone(0);
    setStressOk(0);
    setStressFail(0);
    setDemoErr("");
    setStressFailures([]);
    setStressReasonCounts({});
    setStressLastRunId(`stress_${Date.now()}_${Math.random().toString(16).slice(2)}`);

    for (let i = 1; i <= Math.max(1, Number(stressRuns) || 1); i++) {
      if (stressStopRef.current) break;

      const r = await runOneStress();

      setStressDone((d) => d + 1);

      if (r?.ok) {
        setStressOk((o) => o + 1);
      } else {
        setStressFail((f) => f + 1);
        setDemoErr(r?.error || "Stress test run failed");

        const reason = bucketReason(r?.error);
        const rec = {
          i,
          phase: r?.phase || "unknown",
          reason,
          error: String(r?.error || "unknown"),
          ms: r?.ms ?? null,
          key: "default",
          budgetMs: Number(stressBudgetMs) || 90000,
          allowPlaceholders: !!stressAllowPlaceholders,
        };

        setStressFailures((arr) => [rec, ...arr].slice(0, 50));
        setStressReasonCounts((m) => ({ ...m, [reason]: (m[reason] || 0) + 1 }));
      }

      await new Promise((res) => setTimeout(res, 80));
    }

    setStressRunning(false);
  };

    const stopStress = () => {
    stressStopRef.current = true;
    setStressRunning(false);
  };

  const formatTaskTypeLabel = (t) => {
    const s = String(t || "").trim();
    if (!s) return "";
    return s
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ""))
      .join(" ");
  };

  // -------------------------
  // Share-link emails (admin-editable templates + metrics)
  // -------------------------
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailErr, setEmailErr] = useState("");
  const [emailOk, setEmailOk] = useState("");
  const [emailMetrics, setEmailMetrics] = useState(null);

  const [emailTemplates, setEmailTemplates] = useState([]);
  const [selectedEmailKey, setSelectedEmailKey] = useState("share-invite");

  // Referral program settings (share incentives)
  const [referralBusy, setReferralBusy] = useState(false);
  const [referralErr, setReferralErr] = useState("");
  const [referralOk, setReferralOk] = useState("");
  const [refEnabled, setRefEnabled] = useState(true);
  const [refThreshold, setRefThreshold] = useState("5");
  const [refRewardMonths, setRefRewardMonths] = useState("1");

  // Agent referral codes (commission-based)
  const [agentCodes, setAgentCodes] = useState([]);
  const [agentCodesBusy, setAgentCodesBusy] = useState(false);
  const [agentCodesErr, setAgentCodesErr] = useState("");
  const [newAgentName, setNewAgentName] = useState("");
  const [newAgentEmail, setNewAgentEmail] = useState("");
  const [newAgentCommission, setNewAgentCommission] = useState("15");
  const [newAgentDiscount, setNewAgentDiscount] = useState("10");

  // Referral applications (from /referrals page)
  const [refApps, setRefApps] = useState([]);
  const [refAppsBusy, setRefAppsBusy] = useState(false);
  const [refAppsErr, setRefAppsErr] = useState("");

  const loadAgentCodes = async () => {
    try {
      const data = await apiFetchJson("/api/admin/referral-codes");
      setAgentCodes(data?.codes || []);
    } catch (e) {
      setAgentCodesErr(e?.message || "Failed to load referral codes.");
    }
  };

  const createAgentCode = async () => {
    if (!newAgentName.trim() || !newAgentEmail.trim()) return;
    setAgentCodesBusy(true);
    setAgentCodesErr("");
    try {
      await apiFetchJson("/api/admin/referral-codes", {
        method: "POST",
        body: {
          agentName: newAgentName.trim(),
          agentEmail: newAgentEmail.trim(),
          commissionPercent: Number(newAgentCommission) || 15,
          customerDiscountPercent: Number(newAgentDiscount) || 0,
        },
      });
      setNewAgentName("");
      setNewAgentEmail("");
      await loadAgentCodes();
    } catch (e) {
      setAgentCodesErr(e?.message || "Failed to create referral code.");
    } finally {
      setAgentCodesBusy(false);
    }
  };

  const sendAgentCode = async (id, toEmail) => {
    setAgentCodesBusy(true);
    try {
      await apiFetchJson(`/api/admin/referral-codes/${id}/send`, {
        method: "POST",
        body: { toEmail },
      });
      alert("Referral code email sent!");
    } catch (e) {
      alert("Send failed: " + (e?.message || e));
    } finally {
      setAgentCodesBusy(false);
    }
  };

  const toggleAgentCode = async (id, disabled) => {
    try {
      await apiFetchJson(`/api/admin/referral-codes/${id}`, {
        method: "PUT",
        body: { disabled: !disabled },
      });
      await loadAgentCodes();
    } catch (e) {
      alert("Update failed: " + (e?.message || e));
    }
  };

  const loadRefApps = async () => {
    try {
      const data = await apiFetchJson("/api/admin/referral-applications");
      setRefApps(data?.applications || []);
    } catch (e) {
      setRefAppsErr(e?.message || "Failed to load applications.");
    }
  };

  const approveRefApp = async (id) => {
    setRefAppsBusy(true);
    try {
      const data = await apiFetchJson(`/api/admin/referral-applications/${id}/approve`, {
        method: "PUT",
        body: { commissionPercent: 15, customerDiscountPercent: 10 },
      });
      alert("Approved! Code: " + (data?.referralCode?.code || "created"));
      await loadRefApps();
      await loadAgentCodes();
    } catch (e) {
      alert("Approve failed: " + (e?.message || e));
    } finally {
      setRefAppsBusy(false);
    }
  };

  const declineRefApp = async (id) => {
    setRefAppsBusy(true);
    try {
      await apiFetchJson(`/api/admin/referral-applications/${id}/decline`, { method: "PUT" });
      await loadRefApps();
    } catch (e) {
      alert("Decline failed: " + (e?.message || e));
    } finally {
      setRefAppsBusy(false);
    }
  };

  const selectedEmail = useMemo(
    () => emailTemplates.find((t) => t.key === selectedEmailKey) || null,
    [emailTemplates, selectedEmailKey]
  );

  const [tplEnabled, setTplEnabled] = useState(true);
  const [tplSubject, setTplSubject] = useState("");
  const [tplHtml, setTplHtml] = useState("");
  const [tplFollowupDays, setTplFollowupDays] = useState("");
  const loadDemoInfo = async () => {
    if (!isAdmin) return;
    setDemoErr("");
    setDemoLoading(true);

    const qs = new URLSearchParams();

    const token = getStoredAuthToken();
    if (token) qs.set("token", token);

    // demo key (required by status endpoint)
    qs.set("key", DEMO_TASKSET_KEY);

    // cache-bust so browser never reuses a cached GET
    qs.set("_t", String(Date.now()));

    try {
      // 1) Always load status first — this is what drives count + updatedAt
      const st = await fetchJsonAbs(
        `${API_BASE}/api/demo/taskset/status?${qs.toString()}`
      );

      // Update UI immediately from status, even if taskset fetch fails.
      setDemoInfo((prev) => ({
        id: prev?.id ?? null,
        title: prev?.title || "Demo Taskset",
        count: Number(st?.taskCount || 0),
        updatedAt: st?.updatedAt || null,
      }));

      // 2) Best-effort fetch of the taskset payload (title/id are nice-to-have)
      try {
        const data = await fetchJsonAbs(
          `${API_BASE}/api/demo/taskset?${qs.toString()}`
        );

        setDemoInfo((prev) => ({
          id: data?.taskset?._id || prev?.id || null,
          title:
            data?.taskset?.title ||
            data?.taskset?.name ||
            prev?.title ||
            "Demo Taskset",
          count: prev?.count ?? Number(st?.taskCount || 0),
          updatedAt: prev?.updatedAt ?? st?.updatedAt ?? null,
        }));
      } catch (e) {
        // Quiet fail: we still show fresh updatedAt/count from status.
        if (!IS_PROD) console.warn("[AdminPage] demo taskset payload failed:", e);
      }
    } catch (e) {
      if (!IS_PROD) console.warn("[AdminPage] demo status failed:", e);
      setDemoErr("");
    } finally {
      setDemoLoading(false);
    }
  };

  const regenerateDemoTaskset = async () => {
    setDemoErr("");
    setDemoOk("");
    setDemoBusy(true);
    startFakeProgress();
    setDemoDone(0);
    setDemoTotal(0);

    try {

      // Close any previous stream
      if (sseRef.current) {
        try { sseRef.current.close(); } catch {}
        sseRef.current = null;
      }

      const qs = new URLSearchParams();

      // token-in-query for SSE auth
      const token = getStoredAuthToken();
      if (token) qs.set("token", token);

      // demo key
      qs.set("key", DEMO_TASKSET_KEY);

      // cache-bust
      qs.set("_t", String(Date.now()));

      const url = `${API_BASE}/api/demo/taskset/stream?${qs.toString()}`;
      const es = new EventSource(url);
      sseRef.current = es;

      // --- Status polling fallback (in case SSE events don't arrive) ---
      const statusPollMs = 1500;

      const pollStatus = async () => {
        try {
          const qs2 = new URLSearchParams();

          const token2 = getStoredAuthToken();
          if (token2) qs2.set("token", token2);

          // demo key (required by status endpoint)
          qs2.set("key", DEMO_TASKSET_KEY);

          const st = await fetchJsonAbs(
            `${API_BASE}/api/demo/taskset/status?${qs2.toString()}`
          );

          if (st?.ok && st.exists && (st.taskCount || 0) > 0 && st.updatedAt) return true;
        } catch {}
        return false;
      };

      let pollTimer = window.setInterval(pollStatus, statusPollMs);

      const cleanup = () => {
        setDemoCurrentTask("");
        if (pollTimer) { window.clearInterval(pollTimer); pollTimer = null; }
        if (sseRef.current) { try { sseRef.current.close(); } catch {} sseRef.current = null; }
      };

      es.addEventListener("init", (ev) => {
        const data = JSON.parse(ev.data || "{}");
        const total = Number(data.total || 0);
        setDemoTotal(total);
        setDemoDone(0);
      });

      es.addEventListener("progress", (ev) => {
        const data = JSON.parse(ev.data || "{}");
        const status = String(data.status || "");
        const taskType = String(data.taskType || "");

        if (status === "generating") {
          setDemoCurrentTask(formatTaskTypeLabel(taskType) || taskType);
        }
        if (status === "done" || status === "skipped" || status === "placeholder") {
          setDemoDone((d) => d + 1);
        }
      });

      es.addEventListener("done", async (ev) => {
        cleanup();
        stopFakeProgress(1);

        let data = {};
        try { data = JSON.parse(ev.data || "{}"); } catch {}

        if (data.ok === false) {
          // Generation incomplete — at least one type failed
          const failed = Array.isArray(data.failedTypes) ? data.failedTypes : [];
          const failedLabels = failed.map((t) => formatTaskTypeLabel(t) || t).join(", ");
          setDemoErr(
            `Generation incomplete — ${failed.length} task type${failed.length === 1 ? "" : "s"} failed: ${failedLabels || "unknown"}. Nothing was saved.`
          );
          setDemoBusy(false);
          return;
        }

        if (isAdmin) {
          await loadDemoInfo(); // <-- use the shared function
        }

        setDemoOk("Regenerated ✓");
        window.setTimeout(() => setDemoOk(""), 2000);
        setDemoBusy(false);
      });

      // Listen for per-type failures (sent when a type exhausts all retries)
      es.addEventListener("fail", (ev) => {
        try {
          const data = JSON.parse(ev.data || "{}");
          const label = formatTaskTypeLabel(data.taskType) || data.taskType || "unknown";
          console.warn(`[Demo] Type failed: ${label} — ${data.error || "no details"}`);
          setDemoCurrentTask(`⚠ ${label} failed — retrying others…`);
        } catch {}
      });

      es.addEventListener("task_error", (ev) => {
        try {
          const data = JSON.parse(ev.data || "{}");
          setDemoErr(data?.error ? String(data.error) : "Task generation error");
        } catch {
          setDemoErr("Task generation error");
        }
      });

      es.addEventListener("fatal", (ev) => {
        cleanup();
        stopFakeProgress(1);
        try {
          const data = JSON.parse(ev.data || "{}");
          setDemoErr(data?.error ? String(data.error) : "Stream error");
        } catch {
          setDemoErr("Stream error");
        }
        setDemoBusy(false);
      });

      es.onerror = async () => {
        const ok = await pollStatus();
        cleanup();
        stopFakeProgress(1);

        if (ok) {
          if (isAdmin) await loadDemoInfo();
          setDemoOk("Regenerated ✓ (verified by status)");
          window.setTimeout(() => setDemoOk(""), 2500);
        } else {
          setDemoErr("Stream connection lost (status did not confirm completion).");
        }

        setDemoBusy(false);
      };
    } catch (e) {
      console.warn("[AdminPage] SSE regenerate demo taskset failed:", e);
      setDemoErr("Network error");
      stopFakeProgress(1);
      setDemoBusy(false);
    }
  };

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [codes, setCodes] = useState([]);

  const [tier, setTier] = useState("PRO");
  const [seats, setSeats] = useState(1);
  const [expiresAt, setExpiresAt] = useState(""); // ISO date (YYYY-MM-DD) or empty
  const [codeEmail, setCodeEmail] = useState("");  // optional: email to send the code to
  const [codeSending, setCodeSending] = useState(null); // code _id currently being sent

  const load = async () => {
    if (!isAdmin) return;
    setErr("");
    setBusy(true);
    try {
      const data = await apiFetchJson("/api/admin/access-codes");
      if (!data?.ok) {
        setErr(data?.error || "Could not load access codes.");
        return;
      }
      setCodes(Array.isArray(data.codes) ? data.codes : []);
    } catch (e) {
      setErr(e?.message || "Network error");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!isAdmin) return;
    load();
    loadAgentCodes();
    loadRefApps();
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
      loadDemoInfo();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAdmin]);

  const revoke = async (codeObj) => {
    const id = codeObj?._id || null;
    if (!id) {
      setErr("Cannot revoke: missing code id.");
      return;
    }
    // Minimal confirmation (browser-native)
    const ok = window.confirm("Revoke this access code? This will prevent future claims/uses.");
    if (!ok) return;

    setErr("");
    setBusy(true);
    try {
      // Preferred: DELETE /api/admin/access-codes/:id
      const data = await apiFetchJson(`/api/admin/access-codes/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      });

      // Fallback: if your backend uses POST /revoke, you can switch to that endpoint.
      if (!data?.ok) {
        setErr(data?.error || "Could not revoke code (endpoint may be missing).");
        return;
      }

      await load();
    } catch (e) {
      console.error("Admin revoke code failed:", e);
      setErr(e?.message || "Network error");
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    setErr("");
    setBusy(true);
    try {
      const payload = {
        planTier: tier,
        maxSeats: Math.max(1, Number(seats) || 1),
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      };

      const data = await apiFetchJson("/api/admin/access-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!data?.ok) {
        setErr(data?.error || "Could not create code.");
        return;
      }

      // If an email was provided, send the code immediately
      if (codeEmail.trim() && data.accessCode?._id) {
        try {
          await apiFetchJson(`/api/admin/access-codes/${data.accessCode._id}/send`, {
            method: "POST",
            body: { toEmail: codeEmail.trim() },
          });
          setCodeEmail("");
        } catch (emailErr) {
          setErr("Code created but email failed: " + (emailErr?.message || emailErr));
        }
      }

      await load();
    } catch (e) {
      console.error("Admin create code failed:", e);
      setErr(e?.message || "Network error");
    } finally {
      setBusy(false);
    }
  };

  const sendCodeEmail = async (codeId, toEmail) => {
    if (!toEmail) return;
    setCodeSending(codeId);
    setErr("");
    try {
      const data = await apiFetchJson(`/api/admin/access-codes/${codeId}/send`, {
        method: "POST",
        body: { toEmail },
      });
      if (!data?.ok) throw new Error(data?.error || "Send failed");
      setErr(""); // clear any previous error
      alert("Email sent to " + toEmail);
    } catch (e) {
      setErr(e?.message || "Failed to send email");
    } finally {
      setCodeSending(null);
    }
  };

  async function loadEmailAdmin() {
    if (!isAdmin) return;
    setEmailErr("");
    try {
      const [tRes, mRes, rRes] = await Promise.all([
        apiFetchJson(`/api/admin/email-templates`),
        apiFetchJson(`/api/admin/email-metrics`),
        apiFetchJson(`/api/admin/referral-settings`),
      ]);

      if (tRes?.ok) {
        setEmailTemplates(Array.isArray(tRes.templates) ? tRes.templates : []);
      }
      if (mRes?.ok) setEmailMetrics(mRes.counts || null);

      if (rRes?.ok && rRes.settings) {
        setRefEnabled(rRes.settings.enabled !== false);
        setRefThreshold(String(rRes.settings.threshold ?? 5));
        setRefRewardMonths(String(rRes.settings.rewardMonths ?? 1));
      }
    } catch (e) {
      setEmailErr(e?.message || "Failed to load email admin settings");
    }
  }

  async function saveReferralSettings() {
    if (!isAdmin) return;
    setReferralBusy(true);
    setReferralErr("");
    setReferralOk("");
    try {
      const payload = {
        enabled: !!refEnabled,
        threshold: Math.max(1, Number(refThreshold || 5)),
        rewardMonths: Math.max(0, Number(refRewardMonths || 1)),
      };

      const res = await apiFetchJson(`/api/admin/referral-settings`, {
        method: "PUT",
        body: payload,
      });

      if (!res?.ok) throw new Error(res?.error || "Save failed");
      setReferralOk("Saved.");
      await loadEmailAdmin();
    } catch (e) {
      setReferralErr(e?.message || "Save failed");
    } finally {
      setReferralBusy(false);
    }
  }

  async function saveSelectedTemplate() {
    if (!isAdmin || !selectedEmailKey) return;
    setEmailBusy(true);
    setEmailErr("");
    setEmailOk("");
    try {
      const payload = {
        enabled: !!tplEnabled,
        subject: tplSubject,
        html: tplHtml,
      };
      if (tplFollowupDays !== "") payload.followupDays = Number(tplFollowupDays);

      const res = await apiFetchJson(
        `/api/admin/email-templates/${encodeURIComponent(selectedEmailKey)}`,
        {
          method: "PUT",
          body: payload,
        }
      );

      if (!res?.ok) throw new Error(res?.error || "Save failed");
      setEmailOk("Saved.");
      await loadEmailAdmin();
    } catch (e) {
      setEmailErr(e?.message || "Save failed");
    } finally {
      setEmailBusy(false);
      window.setTimeout(() => setEmailOk(""), 2000);
    }
  }

  // When templates load or selection changes, sync editor fields
  useEffect(() => {
    if (!selectedEmail) return;
    setTplEnabled(selectedEmail.enabled !== false);
    setTplSubject(String(selectedEmail.subject || ""));
    setTplHtml(String(selectedEmail.html || ""));
    setTplFollowupDays(
      selectedEmail.followupDays == null || Number.isNaN(Number(selectedEmail.followupDays))
        ? ""
        : String(selectedEmail.followupDays)
    );
  }, [selectedEmailKey, selectedEmail]);

  // Load email admin settings once when AdminPage opens
  useEffect(() => {
    if (!isAdmin) return;
    loadEmailAdmin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  return (
    <div style={{ padding: 4 }}>
      <h2 style={{ marginTop: 0 }}>Admin</h2>
      {!isAdmin && (
        <div
          style={{
            marginTop: 10,
            padding: 12,
            borderRadius: 14,
            border: "1px solid rgba(255,255,255,0.14)",
            background: "rgba(255,255,255,0.06)",
            color: "rgba(226,232,240,0.9)",
            fontWeight: 700,
          }}
        >
          Admin tools are hidden for this account. If you need access (e.g., demo pool regeneration), ask your system admin to enable admin rights.
        </div>
      )}
      <p style={{ opacity: 0.8, marginTop: 6 }}>
        System-wide controls (shown only to the system admin).
      </p>

      {/* Demo taskset controls */}
      <div
        style={{
          background: "#ffffff",
          borderRadius: 12,
          padding: 14,
          boxShadow: "0 2px 10px rgba(0,0,0,0.08)",
          border: "1px solid rgba(15,23,42,0.08)",
          marginBottom: 14,
          maxWidth: 720,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontWeight: 900, marginBottom: 4 }}>Demo taskset</div>
            <div style={{ opacity: 0.75, fontSize: "0.92rem" }}>
              Regenerate only when you add new task types or want different demo content.
            </div>
          </div>
          <div style={{ fontSize: "0.9rem", textAlign: "right" }}>
            <div style={{ fontWeight: 800 }}>
              {demoInfo ? `${demoInfo.count} tasks` : "—"}
            </div>
            <div style={{ opacity: 0.7 }}>
              Last generated:
              <br />
              {demoInfo?.updatedAt
                ? new Date(demoInfo.updatedAt).toLocaleString()
                : "Unknown"}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end", marginTop: 12 }}>

          <ProgressFillButton
            onClick={regenerateDemoTaskset}
            loading={demoBusy}
            progress={
              demoBusy && demoTotal > 0
                ? Math.min(0.999, demoDone / demoTotal)
                : (demoBusy ? demoProgress : 0)
            }
            style={{
              minWidth: 240,
              padding: "12px 16px",
              borderRadius: 999,
              fontWeight: 900,
            }}
          >
            {demoBusy
            ? `Generating ${demoDone}/${demoTotal || "…"}${demoCurrentTask ? " — " + demoCurrentTask : ""}`
            : "Regenerate demo taskset"}
          </ProgressFillButton>
        </div>

        {demoErr && (
          <div style={{ color: "#b91c1c", marginTop: 10, fontWeight: 800 }}>
            {demoErr}
          </div>
        )}
      </div>

      
      {/* Stress test (Admin) */}
      <div
        style={{
          background: "#ffffff",
          borderRadius: 12,
          padding: 14,
          boxShadow: "0 2px 10px rgba(0,0,0,0.08)",
          border: "1px solid rgba(15,23,42,0.08)",
          marginBottom: 14,
          maxWidth: 720,
        }}
      >
        <div style={{ fontWeight: 900, marginBottom: 6 }}>Stress test (demo regeneration)</div>
        <div style={{ opacity: 0.75, fontSize: "0.92rem", marginBottom: 10 }}>
          Repeats the demo taskset generation stream to help you validate that generation is reliable under load.
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            Runs
            <input
              type="number"
              min={1}
              value={stressRuns}
              onChange={(e) => setStressRuns(e.target.value)}
              style={{ ...ui.inputLight, width: 120 }}
              disabled={stressRunning}
            />
          </label>

          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            Budget (ms)
            <input
              type="number"
              min={5000}
              step={1000}
              value={stressBudgetMs}
              onChange={(e) => setStressBudgetMs(e.target.value)}
              style={{ ...ui.inputLight, width: 140 }}
              disabled={stressRunning}
            />
          </label>

          <label style={{ display: "inline-flex", gap: 8, alignItems: "center", fontWeight: 800 }}>
            <input
              type="checkbox"
              checked={!!stressAllowPlaceholders}
              onChange={(e) => setStressAllowPlaceholders(e.target.checked)}
              disabled={stressRunning}
            />
            Allow placeholders
          </label>

          {!stressRunning ? (
            <button
              type="button"
              onClick={startStress}
              style={{ ...ui.buttonPrimary, minWidth: 160 }}
            >
              Run
            </button>
          ) : (
            <button
              type="button"
              onClick={stopStress}
              style={{ ...ui.buttonGhostDark, minWidth: 160 }}
            >
              Stop
            </button>
          )}
        </div>

        <div style={{ marginTop: 10, display: "flex", gap: 14, flexWrap: "wrap" }}>
          <div>Done: <b>{stressDone}</b> / {Number(stressRuns) || 0}</div>
          <div>OK: <b>{stressOk}</b></div>
          <div>Fail: <b>{stressFail}</b></div>
        </div>
      </div>

      {/* Access codes */}
      <h3 style={{ margin: "8px 0 6px", maxWidth: 720 }}>Access codes</h3>

      <div
        style={{
          background: "#ffffff",
          borderRadius: 12,
          padding: 14,
          boxShadow: "0 2px 10px rgba(0,0,0,0.08)",
          border: "1px solid rgba(15,23,42,0.08)",
          marginBottom: 14,
          maxWidth: 720,
        }}
      >
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
          <div style={{ minWidth: 160 }}>
            <label style={{ ...ui.labelLight }}>Plan tier</label>
            <select
              value={tier}
              onChange={(e) => setTier(e.target.value)}
              style={ui.inputLight}
            >
              <option value="FREE">FREE</option>
              <option value="PLUS">PLUS</option>
              <option value="PRO">PRO</option>
            </select>
          </div>

          <div style={{ minWidth: 120 }}>
            <label style={{ ...ui.labelLight }}>Seats</label>
            <input
              type="number"
              min={1}
              value={seats}
              onChange={(e) => setSeats(e.target.value)}
              style={ui.inputLight}
            />
          </div>

          <div style={{ minWidth: 200 }}>
            <label style={{ ...ui.labelLight }}>Expires (optional)</label>
            <input
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              style={ui.inputLight}
            />
          </div>

          <div style={{ minWidth: 240 }}>
            <label style={{ ...ui.labelLight }}>Send to email (optional)</label>
            <input
              type="email"
              placeholder="teacher@school.edu"
              value={codeEmail}
              onChange={(e) => setCodeEmail(e.target.value)}
              style={ui.inputLight}
            />
          </div>

          <button
            onClick={create}
            disabled={busy}
            style={{ ...ui.buttonPrimary, minWidth: 170 }}
          >
            {busy ? "Working…" : codeEmail.trim() ? "Create & Send" : "Create code"}
          </button>

          <button
            onClick={load}
            disabled={busy}
            style={{ ...ui.buttonGhostDark, minWidth: 130 }}
          >
            Refresh
          </button>
        </div>

        {err && (
          <div style={{ color: "#b91c1c", marginTop: 10, fontWeight: 700 }}>
            {err}
          </div>
        )}
      </div>

      <div
        style={{
          background: "#ffffff",
          borderRadius: 12,
          padding: 14,
          boxShadow: "0 2px 10px rgba(0,0,0,0.08)",
          border: "1px solid rgba(15,23,42,0.08)",
          maxWidth: 980,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontWeight: 800 }}>Codes</div>
          <div style={{ opacity: 0.7 }}>{codes.length} total</div>
        </div>

        <div style={{ marginTop: 10, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.92rem" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid rgba(15,23,42,0.08)" }}>
                <th style={{ padding: "8px 6px" }}>Code</th>
                <th style={{ padding: "8px 6px" }}>Tier</th>
                <th style={{ padding: "8px 6px" }}>Seats</th>
                <th style={{ padding: "8px 6px" }}>Claimed</th>
                <th style={{ padding: "8px 6px" }}>Expires</th>
                <th style={{ padding: "8px 6px" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {codes.map((c) => (
                <tr key={c._id || c.code} style={{ borderBottom: "1px solid rgba(15,23,42,0.06)" }}>
                  <td style={{ padding: "8px 6px", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco" }}>
                    <MaskOnHover value={c.code} />
                  </td>
                  <td style={{ padding: "8px 6px" }}>{c.planTier || c.tier}</td>
                    <td style={{ padding: "8px 6px" }}>{c.maxSeats ?? c.seats ?? 1}</td>
                      <td style={{ padding: "8px 6px" }}>
                        {(c.claimantsCount || 0) > 0 ? `Yes (${c.claimantsCount})` : "No"}
                      </td>
                    <td style={{ padding: "8px 6px" }}>
                    {c.expiresAt ? new Date(c.expiresAt).toLocaleDateString() : "—"}
                  </td>
                  <td style={{ padding: "8px 6px", display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      disabled={busy || codeSending === c._id}
                      onClick={() => {
                        const email = prompt("Send this code to email address:");
                        if (email) sendCodeEmail(c._id, email);
                      }}
                      style={{
                        padding: "6px 10px",
                        borderRadius: 999,
                        border: "1px solid rgba(14,165,233,0.35)",
                        background: "rgba(14,165,233,0.10)",
                        color: "#0369a1",
                        fontWeight: 900,
                        cursor: (busy || codeSending === c._id) ? "not-allowed" : "pointer",
                      }}
                      title="Email this code to someone"
                    >
                      {codeSending === c._id ? "Sending…" : "Send"}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => revoke(c)}
                      style={{
                        padding: "6px 10px",
                        borderRadius: 999,
                        border: "1px solid rgba(239,68,68,0.35)",
                        background: "rgba(239,68,68,0.10)",
                        color: "#991b1b",
                        fontWeight: 900,
                        cursor: busy ? "not-allowed" : "pointer",
                      }}
                      title="Revoke this code"
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
              {codes.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: 10, opacity: 0.7 }}>
                    No codes yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    
      {/* Share-link Email Templates (Admin) */}
      <div
        style={{
          marginTop: 18,
          padding: 14,
          borderRadius: 16,
          border: "1px solid rgba(255,255,255,0.14)",
          background: "rgba(255,255,255,0.06)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontWeight: 900, fontSize: 16 }}>Email invitations</div>
            <div style={{ opacity: 0.8, fontSize: 13, marginTop: 4 }}>
              Edit the system emails used for Share Links (initial + follow-ups).
            </div>
          </div>

          {emailMetrics && (
            <div
              style={{
                display: "flex",
                gap: 10,
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "flex-end",
              }}
            >
              <span style={pill}>Share links: <strong>{emailMetrics.shareLinks || 0}</strong></span>
              <span style={pill}>Invites: <strong>{emailMetrics.invites || 0}</strong></span>
              <span style={pill}>Follow-up 7: <strong>{emailMetrics.followup7 || 0}</strong></span>
              <span style={pill}>Follow-up 30: <strong>{emailMetrics.followup30 || 0}</strong></span>
              <span style={pill}>Used: <strong>{emailMetrics.invitesUsed || 0}</strong></span>
              <span style={pill}>Rewards: <strong>{emailMetrics.rewardEmails || 0}</strong></span>
            </div>
          )}
        </div>

        {emailErr && (
          <div style={{ marginTop: 10, padding: 10, borderRadius: 12, background: "rgba(239,68,68,0.18)", border: "1px solid rgba(255,255,255,0.12)", fontWeight: 800 }}>
            {emailErr}
          </div>
        )}
        {emailOk && (
          <div style={{ marginTop: 10, padding: 10, borderRadius: 12, background: "rgba(34,197,94,0.18)", border: "1px solid rgba(255,255,255,0.12)", fontWeight: 800 }}>
            {emailOk}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10, marginTop: 12 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <label style={{ fontWeight: 900, opacity: 0.9 }}>Template</label>
            <select
              value={selectedEmailKey}
              onChange={(e) => setSelectedEmailKey(e.target.value)}
              style={{
                ...input,
                maxWidth: 360,
                padding: "10px 12px",
                fontWeight: 900,
              }}
            >
              {(emailTemplates || []).map((t) => (
                <option key={t.key} value={t.key} style={{ color: "#000" }}>
                  {t.label ? `${t.label} (${t.key})` : t.key}
                </option>
              ))}
            </select>

            <label style={{ display: "inline-flex", gap: 8, alignItems: "center", fontWeight: 900 }}>
              <input
                type="checkbox"
                checked={!!tplEnabled}
                onChange={(e) => setTplEnabled(e.target.checked)}
              />
              Enabled
            </label>

            {(selectedEmailKey === "share-followup-7" || selectedEmailKey === "share-followup-30") && (
              <div style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontWeight: 900, opacity: 0.9 }}>Follow-up days</span>
                <input
                  value={tplFollowupDays}
                  onChange={(e) => setTplFollowupDays(e.target.value)}
                  placeholder={selectedEmailKey === "share-followup-7" ? "7" : "30"}
                  style={{ ...input, width: 90, textAlign: "center", fontWeight: 900 }}
                />
              </div>
            )}

            <button
              type="button"
              onClick={loadEmailAdmin}
              style={{
                ...pill,
                cursor: "pointer",
                background: "rgba(255,255,255,0.08)",
              }}
            >
              Refresh
            </button>
          </div>

          <div>
            <div style={{ fontWeight: 900, marginBottom: 6 }}>Subject</div>
            <input
              value={tplSubject}
              onChange={(e) => setTplSubject(e.target.value)}
              placeholder="Email subject"
              style={{ ...input, width: "100%", fontWeight: 800 }}
            />
          </div>

          <div>
            <div style={{ fontWeight: 900, marginBottom: 6 }}>
              HTML body
              <span style={{ opacity: 0.75, fontWeight: 700, marginLeft: 10, fontSize: 12 }}>
                {"Placeholders: {{SENDER_NAME}}, {{TASKSET_NAME}}, {{SHARE_URL}}, {{EXPIRES_DATE}}, {{CUSTOM_MESSAGE_BLOCK}}"}
              </span>
            </div>
            <textarea
              value={tplHtml}
              onChange={(e) => setTplHtml(e.target.value)}
              rows={12}
              style={{
                ...input,
                width: "100%",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
                fontSize: 12,
                lineHeight: 1.35,
              }}
            />
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              disabled={emailBusy}
              onClick={saveSelectedTemplate}
              style={{
                padding: "10px 14px",
                borderRadius: 999,
                border: "1px solid rgba(148,163,184,0.55)",
                background: emailBusy
                  ? "rgba(255,255,255,0.10)"
                  : "linear-gradient(135deg, rgba(34,197,94,0.75), rgba(14,165,233,0.75))",
                color: "#fff",
                fontWeight: 950,
                cursor: emailBusy ? "not-allowed" : "pointer",
              }}
            >
              {emailBusy ? "Saving…" : "Save template"}
            </button>

            <a
              href="https://www.curriculate.net/freetrial"
              target="_blank"
              rel="noreferrer"
              style={{
                ...pill,
                cursor: "pointer",
                background: "rgba(34,197,94,0.18)",
                textDecoration: "none",
              }}
              title="Landing page for Free Trial"
            >
              Free Trial page
            </a>
          </div>
        </div>
      </div>

      {/* Referral incentives (Admin) */}
      <div
        style={{
          marginTop: 18,
          padding: 14,
          borderRadius: 16,
          border: "1px solid rgba(255,255,255,0.14)",
          background: "rgba(255,255,255,0.06)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontWeight: 900, fontSize: 16 }}>Referral rewards</div>
            <div style={{ opacity: 0.8, fontSize: 13, marginTop: 4 }}>
              Incentivize presenters to share Curriculate with other teachers. When a shared invite is <b>used</b> {" "}
              (recipient runs the task set), it counts toward the sender's goal.
            </div>
          </div>
        </div>

        {referralErr && (
          <div style={{ marginTop: 10, padding: 10, borderRadius: 12, background: "rgba(239,68,68,0.18)", border: "1px solid rgba(255,255,255,0.12)", fontWeight: 800 }}>
            {referralErr}
          </div>
        )}
        {referralOk && (
          <div style={{ marginTop: 10, padding: 10, borderRadius: 12, background: "rgba(34,197,94,0.18)", border: "1px solid rgba(255,255,255,0.12)", fontWeight: 800 }}>
            {referralOk}
          </div>
        )}

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
          <label style={{ display: "inline-flex", gap: 8, alignItems: "center", fontWeight: 900 }}>
            <input
              type="checkbox"
              checked={!!refEnabled}
              onChange={(e) => setRefEnabled(e.target.checked)}
            />
            Enabled
          </label>

          <div style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontWeight: 900, opacity: 0.9 }}>Goal</span>
            <input
              value={refThreshold}
              onChange={(e) => setRefThreshold(e.target.value)}
              style={{ ...input, width: 90, textAlign: "center", fontWeight: 900 }}
            />
            <span style={{ opacity: 0.85 }}>successful runs</span>
          </div>

          <div style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontWeight: 900, opacity: 0.9 }}>Reward</span>
            <input
              value={refRewardMonths}
              onChange={(e) => setRefRewardMonths(e.target.value)}
              style={{ ...input, width: 90, textAlign: "center", fontWeight: 900 }}
            />
            <span style={{ opacity: 0.85 }}>month(s) free</span>
          </div>

          <button
            type="button"
            disabled={referralBusy}
            onClick={saveReferralSettings}
            style={{
              padding: "10px 14px",
              borderRadius: 999,
              border: "1px solid rgba(148,163,184,0.55)",
              background: referralBusy
                ? "rgba(255,255,255,0.10)"
                : "linear-gradient(135deg, rgba(34,197,94,0.75), rgba(14,165,233,0.75))",
              color: "#fff",
              fontWeight: 950,
              cursor: referralBusy ? "not-allowed" : "pointer",
            }}
          >
            {referralBusy ? "Saving…" : "Save referral settings"}
          </button>
        </div>

        <div style={{ marginTop: 10, opacity: 0.8, fontSize: 12 }}>
          Reward emails use the <b>referral-reward</b> template above. Billing credits can be wired into your subscription system later.
        </div>
      </div>

      {/* ===== Referral Applications (from /referrals page) ===== */}
      <h3 style={{ margin: "20px 0 6px", maxWidth: 980 }}>Referral Applications</h3>

      <div style={{ background: "#ffffff", borderRadius: 12, padding: 14, boxShadow: "0 2px 10px rgba(0,0,0,0.08)", border: "1px solid rgba(15,23,42,0.08)", maxWidth: 980 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
          <div style={{ fontWeight: 800 }}>Pending Applications</div>
          <button onClick={loadRefApps} disabled={refAppsBusy} style={{ ...ui.buttonGhostDark, fontSize: 12, padding: "6px 12px" }}>Refresh</button>
        </div>

        {refAppsErr && <div style={{ color: "#b91c1c", fontWeight: 700, marginBottom: 8 }}>{refAppsErr}</div>}

        {refApps.filter((a) => a.status === "pending").length === 0 ? (
          <div style={{ opacity: 0.6, fontSize: 13 }}>No pending applications.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.88rem" }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid rgba(15,23,42,0.08)" }}>
                  <th style={{ padding: "8px 6px" }}>Name</th>
                  <th style={{ padding: "8px 6px" }}>Email</th>
                  <th style={{ padding: "8px 6px" }}>Organization</th>
                  <th style={{ padding: "8px 6px" }}>Message</th>
                  <th style={{ padding: "8px 6px" }}>Applied</th>
                  <th style={{ padding: "8px 6px" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {refApps.filter((a) => a.status === "pending").map((a) => (
                  <tr key={a._id} style={{ borderBottom: "1px solid rgba(15,23,42,0.05)" }}>
                    <td style={{ padding: "8px 6px", fontWeight: 700 }}>{a.name}</td>
                    <td style={{ padding: "8px 6px" }}>{a.email}</td>
                    <td style={{ padding: "8px 6px" }}>{a.organization || "—"}</td>
                    <td style={{ padding: "8px 6px", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.message || "—"}</td>
                    <td style={{ padding: "8px 6px", fontSize: 11, opacity: 0.7 }}>{a.createdAt ? new Date(a.createdAt).toLocaleDateString() : "—"}</td>
                    <td style={{ padding: "8px 6px", display: "flex", gap: 6 }}>
                      <button onClick={() => approveRefApp(a._id)} disabled={refAppsBusy} style={{ ...ui.buttonPrimary, fontSize: 11, padding: "4px 10px" }}>Approve</button>
                      <button onClick={() => declineRefApp(a._id)} disabled={refAppsBusy} style={{ ...ui.buttonGhostDark, fontSize: 11, padding: "4px 10px" }}>Decline</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {refApps.filter((a) => a.status !== "pending").length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 12, opacity: 0.6, marginBottom: 6 }}>Previously reviewed ({refApps.filter((a) => a.status !== "pending").length})</div>
            {refApps.filter((a) => a.status !== "pending").slice(0, 10).map((a) => (
              <div key={a._id} style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 12, padding: "4px 0", opacity: 0.7 }}>
                <span style={{ fontWeight: 700, minWidth: 70, color: a.status === "approved" ? "#16a34a" : "#dc2626" }}>{a.status}</span>
                <span>{a.name}</span>
                <span style={{ opacity: 0.6 }}>{a.email}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ===== Agent Referral Codes ===== */}
      <h3 style={{ margin: "20px 0 6px", maxWidth: 980 }}>Agent Referral Codes</h3>

      <div style={{ background: "#ffffff", borderRadius: 12, padding: 14, boxShadow: "0 2px 10px rgba(0,0,0,0.08)", border: "1px solid rgba(15,23,42,0.08)", marginBottom: 14, maxWidth: 980 }}>
        <div style={{ fontWeight: 800, marginBottom: 8 }}>Create new referral code</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
          <div style={{ minWidth: 160 }}>
            <label style={{ ...ui.labelLight }}>Agent name</label>
            <input value={newAgentName} onChange={(e) => setNewAgentName(e.target.value)} placeholder="Jane Smith" style={ui.inputLight} />
          </div>
          <div style={{ minWidth: 200 }}>
            <label style={{ ...ui.labelLight }}>Agent email</label>
            <input type="email" value={newAgentEmail} onChange={(e) => setNewAgentEmail(e.target.value)} placeholder="jane@example.com" style={ui.inputLight} />
          </div>
          <div style={{ minWidth: 100 }}>
            <label style={{ ...ui.labelLight }}>Commission %</label>
            <input type="number" min={0} max={100} value={newAgentCommission} onChange={(e) => setNewAgentCommission(e.target.value)} style={ui.inputLight} />
          </div>
          <div style={{ minWidth: 120 }}>
            <label style={{ ...ui.labelLight }}>Customer discount %</label>
            <input type="number" min={0} max={100} value={newAgentDiscount} onChange={(e) => setNewAgentDiscount(e.target.value)} style={ui.inputLight} />
          </div>
          <button onClick={createAgentCode} disabled={agentCodesBusy || !newAgentName.trim() || !newAgentEmail.trim()} style={{ ...ui.buttonPrimary, minWidth: 160 }}>
            {agentCodesBusy ? "Creating…" : "Create & email code"}
          </button>
        </div>
        {agentCodesErr && <div style={{ color: "#b91c1c", marginTop: 8, fontWeight: 700 }}>{agentCodesErr}</div>}
      </div>

      <div style={{ background: "#ffffff", borderRadius: 12, padding: 14, boxShadow: "0 2px 10px rgba(0,0,0,0.08)", border: "1px solid rgba(15,23,42,0.08)", maxWidth: 980 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
          <div style={{ fontWeight: 800 }}>Active codes</div>
          <div style={{ display: "flex", gap: 8 }}>
            <span style={{ opacity: 0.7 }}>{agentCodes.length} total</span>
            <button onClick={loadAgentCodes} style={{ ...ui.buttonGhostDark, fontSize: 11, padding: "4px 10px" }}>Refresh</button>
          </div>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.88rem" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid rgba(15,23,42,0.08)" }}>
                <th style={{ padding: "8px 6px" }}>Code</th>
                <th style={{ padding: "8px 6px" }}>Agent</th>
                <th style={{ padding: "8px 6px" }}>Commission</th>
                <th style={{ padding: "8px 6px" }}>Discount</th>
                <th style={{ padding: "8px 6px" }}>Conversions</th>
                <th style={{ padding: "8px 6px" }}>Revenue</th>
                <th style={{ padding: "8px 6px" }}>Commission Owed</th>
                <th style={{ padding: "8px 6px" }}>Status</th>
                <th style={{ padding: "8px 6px" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {agentCodes.map((c) => (
                <tr key={c._id} style={{ borderBottom: "1px solid rgba(15,23,42,0.05)", opacity: c.disabled ? 0.5 : 1 }}>
                  <td style={{ padding: "8px 6px", fontWeight: 900, fontFamily: "monospace", letterSpacing: 1 }}>{c.code}</td>
                  <td style={{ padding: "8px 6px" }}>
                    <div style={{ fontWeight: 700 }}>{c.agentName}</div>
                    <div style={{ fontSize: 11, opacity: 0.6 }}>{c.agentEmail}</div>
                  </td>
                  <td style={{ padding: "8px 6px" }}>{c.commissionPercent}%</td>
                  <td style={{ padding: "8px 6px" }}>{c.customerDiscountPercent || 0}%</td>
                  <td style={{ padding: "8px 6px", fontWeight: 700 }}>{c.totalConversions || 0}</td>
                  <td style={{ padding: "8px 6px" }}>${((c.totalRevenueCents || 0) / 100).toFixed(2)}</td>
                  <td style={{ padding: "8px 6px", fontWeight: 700, color: (c.totalCommissionCents - (c.totalPaidCents || 0)) > 0 ? "#dc2626" : "#16a34a" }}>
                    ${(((c.totalCommissionCents || 0) - (c.totalPaidCents || 0)) / 100).toFixed(2)}
                  </td>
                  <td style={{ padding: "8px 6px" }}>
                    <span style={{ padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 800, background: c.disabled ? "#fecaca" : "#dcfce7", color: c.disabled ? "#991b1b" : "#166534" }}>
                      {c.disabled ? "Disabled" : "Active"}
                    </span>
                  </td>
                  <td style={{ padding: "8px 6px", display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button onClick={() => sendAgentCode(c._id, c.agentEmail)} disabled={agentCodesBusy} style={{ ...ui.buttonGhostDark, fontSize: 10, padding: "3px 8px" }}>Email</button>
                    <button onClick={() => toggleAgentCode(c._id, c.disabled)} style={{ ...ui.buttonGhostDark, fontSize: 10, padding: "3px 8px" }}>
                      {c.disabled ? "Enable" : "Disable"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

</div>
  );
}


function ProgressFillButton({ onClick, loading, progress = 0, style = {}, children }) {
  const p = Math.max(0, Math.min(1, Number(progress) || 0));
  return (
    <button
      type="button"
      onClick={loading ? undefined : onClick}
      disabled={!!loading}
      style={{
        position: "relative",
        overflow: "hidden",
        border: "none",
        cursor: loading ? "not-allowed" : "pointer",
        opacity: loading ? 0.9 : 1,
        background: "linear-gradient(180deg, #38bdf8 0%, #0ea5e9 55%, #0284c7 100%)",
        color: "#06263a",
        boxShadow: "0 10px 24px rgba(14,165,233,0.25)",
        ...style,
      }}
    >
      <span
        aria-hidden
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: `${p * 100}%`,
          background: "rgba(255,255,255,0.22)",
          transition: "width 140ms linear",
        }}
      />
      <span style={{ position: "relative", fontWeight: 900 }}>
        {children}
      </span>
    </button>
  );
}

const ui = {
  buttonPrimary: {
    border: "none",
    borderRadius: 12,
    padding: "10px 12px",
    fontWeight: 800,
    cursor: "pointer",
    background: "linear-gradient(180deg, #38bdf8 0%, #0ea5e9 55%, #0284c7 100%)",
    color: "#06263a",
    boxShadow: "0 10px 24px rgba(14,165,233,0.25)",
  },
  buttonGhost: {
    fontSize: "0.85rem",
    borderRadius: 10,
    border: "1px solid rgba(148,163,184,0.35)",
    padding: "8px 10px",
    backgroundColor: "rgba(255,255,255,0.06)",
    color: "#e5e7eb",
    cursor: "pointer",
  },
  buttonGhostDark: {
    borderRadius: 12,
    padding: "10px 12px",
    fontWeight: 800,
    cursor: "pointer",
    background: "#ffffff",
    color: "#0f172a",
    border: "1px solid rgba(15,23,42,0.15)",
  },
  input: {
    width: "100%",
    padding: "11px 12px",
    borderRadius: 12,
    border: "1px solid rgba(148,163,184,0.35)",
    background: "rgba(255,255,255,0.06)",
    color: "#f9fafb",
    outline: "none",
    boxSizing: "border-box",
    fontSize: "0.98rem",
  },
  label: {
    display: "block",
    fontSize: "0.85rem",
    fontWeight: 700,
    opacity: 0.88,
    marginBottom: 6,
  },
  inputLight: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(15,23,42,0.12)",
    background: "#ffffff",
    color: "#0f172a",
    outline: "none",
    boxSizing: "border-box",
    fontSize: "0.95rem",
  },
  labelLight: {
    display: "block",
    fontSize: "0.85rem",
    fontWeight: 800,
    opacity: 0.85,
    marginBottom: 6,
    color: "#0f172a",
  },
};

export default TeacherApp;
