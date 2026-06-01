// teacher-app/src/pages/SharedPresenterLaunch.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiFetch } from "../api/apiFetch";
import { DISALLOWED_ROOM_CODES } from "../disallowedRoomCodes.js";
import { PageShell, PageHeader } from "../components/ui";

function generateRoomCode(length = 4) {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  for (let attempts = 0; attempts < 1000; attempts++) {
    let code = "";
    for (let i = 0; i < length; i++) code += chars[Math.floor(Math.random() * chars.length)];
    if (!DISALLOWED_ROOM_CODES?.has?.(code)) return code;
  }
  return "A7FQ";
}

export default function SharedPresenterLaunch() {
  const { token } = useParams();
  const navigate = useNavigate();

  const [status, setStatus] = useState("Opening shared task set…");
  const [details, setDetails] = useState(null);
  const [error, setError] = useState("");

  const roomCode = useMemo(() => generateRoomCode(4), []);

  useEffect(() => {
    let alive = true;

    async function run() {
      try {
        setError("");
        setStatus("Validating link…");
        const data = await apiFetch(`/api/shared/${encodeURIComponent(token)}`);
        if (!data?.ok) throw new Error(data?.error || "Invalid or expired link.");

        if (!alive) return;
        setDetails(data);

        const reportOwnerName = data?.ownerName || "";
        const reportOwnerEmail = data?.ownerEmail || "";
        const reportOwnerId = data?.ownerId || "";
        const tasksetId = data?.tasksetId || "";

        // Open projection screen (new tab)
        setStatus("Opening projection screen…");
        const hostUrl =
          `/host?room=${encodeURIComponent(roomCode)}` +
          (token ? `&sharedToken=${encodeURIComponent(token)}` : "") +
          (reportOwnerName ? `&reportOwnerName=${encodeURIComponent(reportOwnerName)}` : "") +
          (reportOwnerEmail ? `&reportOwnerEmail=${encodeURIComponent(reportOwnerEmail)}` : "") +
          (reportOwnerId ? `&reportOwnerId=${encodeURIComponent(reportOwnerId)}` : "") +
          (tasksetId ? `&tasksetId=${encodeURIComponent(tasksetId)}` : "");

        // Mark this share as "used" for follow-up suppression
        try {
          await apiFetch(`/api/shared/${encodeURIComponent(token)}/mark-used`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ roomCode }),
          });
        } catch {
          // non-fatal
        }

        window.open(hostUrl, "_blank", "noopener,noreferrer");

        // Go to presenter console in THIS tab (so you can still use Back button)
        setStatus("Opening presenter console…");
        const liveUrl =
          `/live?room=${encodeURIComponent(roomCode)}` +
          (token ? `&sharedToken=${encodeURIComponent(token)}` : "") +
          (reportOwnerName ? `&reportOwnerName=${encodeURIComponent(reportOwnerName)}` : "") +
          (reportOwnerEmail ? `&reportOwnerEmail=${encodeURIComponent(reportOwnerEmail)}` : "") +
          (reportOwnerId ? `&reportOwnerId=${encodeURIComponent(reportOwnerId)}` : "") +
          (tasksetId ? `&tasksetId=${encodeURIComponent(tasksetId)}` : "");

        navigate(liveUrl, { replace: true });
      } catch (e) {
        if (!alive) return;
        setError(e?.message || "Failed to open shared task set.");
        setStatus("Could not open shared task set.");
      }
    }

    run();
    return () => {
      alive = false;
    };
  }, [token, navigate, roomCode]);

  return (
    <PageShell maxWidth={860}>
      <PageHeader title="Shared task set" subtitle={status} />

      {error && (
        <div
          style={{
            marginTop: 12,
            padding: 12,
            borderRadius: 12,
            background: "#fef2f2",
            border: "1px solid #fecaca",
            color: "#991b1b",
          }}
        >
          {error}
        </div>
      )}

      {details?.ok && (
        <div
          style={{
            marginTop: 14,
            padding: 12,
            borderRadius: 12,
            background: "#f8fafc",
            border: "1px solid #e5e7eb",
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 6 }}>
            TaskSet from {details.ownerName || details.ownerEmail || "a teacher"}
          </div>
          <div style={{ fontSize: "0.9rem", color: "#374151" }}>
            Room code: <strong>{roomCode}</strong>
          </div>
          <div style={{ marginTop: 8, fontSize: "0.82rem", color: "#6b7280" }}>
            If the projection tab was blocked by your browser, allow pop-ups for this site and refresh.
          </div>
        </div>
      )}
    </PageShell>
  );
}
