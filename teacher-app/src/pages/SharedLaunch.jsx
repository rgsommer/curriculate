// teacher-app/src/pages/SharedLaunch.jsx
import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiFetchJson } from "../api/apiFetch";

function setTokenEverywhere(token) {
  try { localStorage.setItem("token", token); } catch {}
}

export default function SharedLaunch() {
  const { token } = useParams();
  const nav = useNavigate();
  const [msg, setMsg] = useState("Launching shared task set…");

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const data = await apiFetchJson(`/api/shared/${encodeURIComponent(token)}/launch`, {
          method: "POST",
          body: {},
        });

        if (!data?.ok) throw new Error(data?.error || "Failed to launch");

        // Store guest presenter token
        setTokenEverywhere(data.presenterJwt);

        // Set room code override
        localStorage.setItem("curriculateRoomCodeOverride", String(data.roomCode || ""));

        // Set active taskset meta so LiveSession knows what to run
        if (data.tasksetMeta?._id) {
          localStorage.setItem("curriculateActiveTasksetId", String(data.tasksetMeta._id));
          localStorage.setItem("curriculateActiveTasksetMeta", JSON.stringify({
            _id: String(data.tasksetMeta._id),
            name: data.tasksetMeta.name || "Task Set",
            numTasks: Number(data.tasksetMeta.numTasks || 0) || 0,
            subject: data.tasksetMeta.subject || "",
            gradeLevel: data.tasksetMeta.gradeLevel || "",
            shared: true,
            authorDisplay: data.authorDisplay || "",
            expiresAt: data.expiresAt || "",
          }));
        }

        localStorage.setItem("curriculateLaunchImmediately", "true");

        // Optional: store attribution for reports
        localStorage.setItem("curriculateSharedAuthorDisplay", String(data.authorDisplay || ""));
        localStorage.setItem("curriculateSharedExpiresAt", String(data.expiresAt || ""));
        localStorage.setItem("curriculateSharedFromTeacherId", String(data.sharedFromTeacherId || ""));
        localStorage.setItem("curriculateSharedFromTeacherEmail", String(data.sharedFromTeacherEmail || ""));

        if (!alive) return;

        // Go to live presenter controls
        nav("/live", { replace: true });
      } catch (e) {
        console.error("[SharedLaunch] error:", e);
        if (!alive) return;
        setMsg(e?.message || "Could not launch shared task set.");
      }
    })();

    return () => { alive = false; };
  }, [token, nav]);

  return (
    <div style={{ padding: 24, fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif" }}>
      <div style={{ fontWeight: 900, fontSize: "1.1rem" }}>{msg}</div>
      <div style={{ marginTop: 10, color: "#6b7280" }}>
        If this link expired, ask the sender to generate a new one.
      </div>
    </div>
  );
}
