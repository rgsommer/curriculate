// teacher-app/src/TeacherApp.jsx
import React, { useState, useEffect, useMemo } from "react";
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
import { apiFetch } from "./api/apiFetch";

import { useAuth } from "./auth/useAuth";
import { DISALLOWED_ROOM_CODES } from "./disallowedRoomCodes.js";

import { socket } from "./socket"; // adjust path if needed

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
  const [roomCode, setRoomCode] = useState(() => generateRoomCode());
  
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

  const [entryOk, setEntryOk] = useState(() => {
    try {
      return localStorage.getItem(ENTRY_KEY) === "1";
    } catch {
      return false;
    }
  });

  // Ensure room exists + keepalive for whole session
  useEffect(() => {
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
  }, [roomCode]);

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
    } catch {}
    setEntryOk(false);
  };

  const logoutWithClear = () => {
    clearEntryOk();
    logout();
  };

  // After auth is established, require entry code unless already verified
  if (isAuthenticated && !entryOk) {
    return (
      <EntryGateServer
        user={user}
        onPass={() => {
          try {
            const v = user?.email ? `1:${user.email}` : "1";
            localStorage.setItem(ENTRY_KEY, "1");
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
            AI Task Sets
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
          You’re on the <b>{tier}</b> tier. You can change or upgrade later in{" "}
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

/**
 * Inline Admin page so you don't have to create a new file.
 * Uses:
 * - GET  /api/admin/access-codes
 * - POST /api/admin/access-codes
 */
function AdminPage({ isAdmin = false }) {
  // -------------------------
  // Demo taskset (system-admin only)
  // -------------------------
  const DEMO_KEY_STORAGE = "curriculate.demoAdminKey";
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoErr, setDemoErr] = useState("");
  const [demoInfo, setDemoInfo] = useState(null);

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

  const selectedEmail = useMemo(
    () => emailTemplates.find((t) => t.key === selectedEmailKey) || null,
    [emailTemplates, selectedEmailKey]
  );

  const [tplEnabled, setTplEnabled] = useState(true);
  const [tplSubject, setTplSubject] = useState("");
  const [tplHtml, setTplHtml] = useState("");
  const [tplFollowupDays, setTplFollowupDays] = useState("");

  const [demoKey, setDemoKey] = useState(() => {
    try {
      return localStorage.getItem(DEMO_KEY_STORAGE) || "";
    } catch {
      return "";
    }
  });

  const loadDemoInfo = async () => {
    setDemoErr("");
    setDemoLoading(true);
    try {
      const res = await apiFetch("/api/demo/taskset");
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setDemoErr(data?.error || "Could not load demo taskset.");
        return;
      }
      const ts = data.taskset || null;
      setDemoInfo(
        ts
          ? {
              id: ts._id || null,
              title: ts.title || ts.name || "Demo Taskset",
              count: Array.isArray(ts.tasks) ? ts.tasks.length : Array.isArray(ts.items) ? ts.items.length : 0,
              updatedAt: ts.updatedAt || ts.modifiedAt || ts.createdAt || null,
            }
          : null
      );
    } catch (e) {
      console.warn("[AdminPage] load demo taskset failed:", e);
      setDemoErr("Network error");
    } finally {
      setDemoLoading(false);
    }
  };

  const regenerateDemoTaskset = async () => {
    setDemoErr("");
    setDemoBusy(true);
    try {
      try {
        localStorage.setItem(DEMO_KEY_STORAGE, demoKey || "");
      } catch {}

      const res = await apiFetch("/api/demo/taskset/regenerate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(demoKey ? { "x-demo-admin-key": demoKey } : {}),
        },
        body: JSON.stringify({}),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setDemoErr(data?.error || "Could not regenerate demo taskset.");
        return;
      }
      await loadDemoInfo();
    } catch (e) {
      console.warn("[AdminPage] regenerate demo taskset failed:", e);
      setDemoErr("Network error");
    } finally {
      setDemoBusy(false);
    }
  };

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [codes, setCodes] = useState([]);

  const [tier, setTier] = useState("PRO");
  const [seats, setSeats] = useState(1);
  const [expiresAt, setExpiresAt] = useState(""); // ISO date (YYYY-MM-DD) or empty

  const load = async () => {
    setErr("");
    setBusy(true);
    try {
      const res = await apiFetch("/api/admin/access-codes");
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setErr(data?.error || "Could not load access codes.");
        return;
      }
      setCodes(Array.isArray(data.codes) ? data.codes : []);
    } catch {
      setErr("Network error");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    loadDemoInfo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const create = async () => {
    setErr("");
    setBusy(true);
    try {
      const payload = {
        tier,
        seats: Math.max(1, Number(seats) || 1),
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      };

      const res = await apiFetch("/api/admin/access-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setErr(data?.error || "Could not create code.");
        return;
      }
      await load();
    } catch (e) {
      console.error("Admin create code failed:", e);
      setErr("Network error");
    } finally {
      setBusy(false);
    }
  };
  async function loadEmailAdmin() {
    if (!isAdmin) return;
    setEmailErr("");
    try {
      const [tRes, mRes, rRes] = await Promise.all([
        fetchJsonSafe(`${API_BASE}/api/admin/email-templates`, { credentials: "include" }),
        fetchJsonSafe(`${API_BASE}/api/admin/email-metrics`, { credentials: "include" }),
        fetchJsonSafe(`${API_BASE}/api/admin/referral-settings`, { credentials: "include" }),
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

      const res = await fetchJsonSafe(`${API_BASE}/api/admin/referral-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
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

      const res = await fetchJsonSafe(
        `${API_BASE}/api/admin/email-templates/${encodeURIComponent(selectedEmailKey)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(payload),
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
              Stored in Mongo; regenerate only when you add new task types or want different demo content.
            </div>
          </div>
          <div style={{ opacity: 0.75, fontSize: "0.9rem" }}>
            {demoInfo
              ? `${demoInfo.count} tasks` + (demoInfo.updatedAt ? ` • updated ${new Date(demoInfo.updatedAt).toLocaleString()}` : "")
              : "(not loaded)"}
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end", marginTop: 12 }}>
          <div style={{ minWidth: 260, flex: 1 }}>
            <label style={{ ...ui.labelLight }}>Demo admin key</label>
            <input
              value={demoKey}
              onChange={(e) => setDemoKey(e.target.value)}
              placeholder="(x-demo-admin-key header)"
              style={ui.inputLight}
            />
          </div>

          <button
            onClick={regenerateDemoTaskset}
            disabled={demoBusy || !isAdmin}
            style={{ ...ui.buttonPrimary, minWidth: 220 }}
          >
            {demoBusy ? "Working…" : "Regenerate"}
          </button>
        </div>

        {demoErr && (
          <div style={{ color: "#b91c1c", marginTop: 10, fontWeight: 800 }}>
            {demoErr}
          </div>
        )}
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

          <button
            onClick={create}
            disabled={busy}
            style={{ ...ui.buttonPrimary, minWidth: 170 }}
          >
            {busy ? "Working…" : "Create code"}
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
              </tr>
            </thead>
            <tbody>
              {codes.map((c) => (
                <tr key={c._id || c.code} style={{ borderBottom: "1px solid rgba(15,23,42,0.06)" }}>
                  <td style={{ padding: "8px 6px", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco" }}>
                    {c.code}
                  </td>
                  <td style={{ padding: "8px 6px" }}>{c.planTier || c.tier}</td>
                  <td style={{ padding: "8px 6px" }}>{c.maxSeats ?? c.seats ?? 1}</td>
                  <td style={{ padding: "8px 6px" }}>
                    {c.claimedBy ? "Yes" : "No"}
                  </td>
                  <td style={{ padding: "8px 6px" }}>
                    {c.expiresAt ? new Date(c.expiresAt).toLocaleDateString() : "—"}
                  </td>
                </tr>
              ))}
              {codes.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ padding: 10, opacity: 0.7 }}>
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
              (recipient runs the task set), it counts toward the sender’s goal.
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

</div>
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
