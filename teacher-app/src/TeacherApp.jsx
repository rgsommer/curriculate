// teacher-app/src/TeacherApp.jsx
import React, { useState, useEffect, useMemo } from "react";
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
  const [roomCode, setRoomCode] = useState(() => generateRoomCode());
  const location = useLocation();

  const { isAuthenticated, user, logout } = useAuth();

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
      // (Optional hardening) tie to user email if present so different users don't inherit.
      const stored = localStorage.getItem(ENTRY_KEY);
      return stored === "1" || stored === (user?.email ? `1:${user.email}` : "1");
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

  const onLive =
    location.pathname === "/" || location.pathname.startsWith("/live");
  const onHost = location.pathname.startsWith("/host");
  const onTasksets = location.pathname.startsWith("/tasksets");
  const onReports = location.pathname.startsWith("/reports");
  const onMyPlan = location.pathname.startsWith("/my-plan");
  const onProfile = location.pathname.startsWith("/teacher/profile");
  const onAiTasksets = location.pathname.startsWith("/teacher/ai-tasksets");
  const onAdmin = location.pathname.startsWith("/admin");

  const requireAuth = (element) => (isAuthenticated ? element : <Login />);

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
            localStorage.setItem(ENTRY_KEY, v);
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
            <NavLinkButton to="/admin/access-codes" active={onAdmin}>
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
          <Route
            path="/admin/access-codes"
            element={requireAuth(<AdminAccessCodesPage />)}
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

function HeaderBar({ isAuthenticated, user, logoutWithClear }) {
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
function AdminAccessCodesPage() {
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

  // 🔑 THIS IS THE MISSING PIECE
  if (data.token) {
    localStorage.setItem("token", data.token);
  } else {
    throw new Error("Login succeeded but no token returned");
  }

  useEffect(() => {
    load();
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

  return (
    <div style={{ padding: 4 }}>
      <h2 style={{ marginTop: 0 }}>Admin • Access Codes</h2>
      <p style={{ opacity: 0.8, marginTop: 6 }}>
        Create and manage teacher access codes.
      </p>

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
