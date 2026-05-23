// student-app/src/components/tasks/types/QuestTask.jsx
//
// Renderer for the "quest" task type — the mission card.
// Shows:
//   - mission title + narrative scenario
//   - each objective with progress bar (required vs current inventory)
//   - the resource list, with Buy buttons (coin acquisition path)
//   - "Launch Mission" CTA when all objective resources are met
//
// State source of truth: the server. We fetch via quest:requestState on mount,
// and re-fetch after every quest:stateUpdated broadcast.
import React, { useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import QrScanner from "../../QrScanner";

export default function QuestTask({ task, onSubmit, disabled, socket, roomCode, teamId, taskIndex, practiceMode = false }) {
  const cfg = task?.config || {};
  // In practice mode there is no live socket-driven economy. Seed
  // local-only state with enough coins to actually try the Buy buttons.
  // Tester (Gavy, May 2026, via skip): 'for the demo, with no coins,
  // how is one to buy? could others buy from me? how? what has to be
  // done?'
  const PRACTICE_STARTER_COINS = 30;
  const objectives = Array.isArray(cfg.objectives) ? cfg.objectives : [];
  const resources  = Array.isArray(cfg.resources)  ? cfg.resources  : [];
  const ranks      = Array.isArray(cfg.ranks)      ? cfg.ranks      : [];

  const [state, setState] = useState(
    // Practice mode: pre-seed local state so the buttons actually work.
    practiceMode ? { coins: PRACTICE_STARTER_COINS, inventory: {} } : null,
  );
  const [busyResId, setBusyResId] = useState(null);
  const [error, setError] = useState(null);

  // ── Peer-to-peer trade state ──
  const [tradeMode, setTradeMode] = useState(null); // null | "sell" | "buy"
  const [sellResId, setSellResId] = useState("");
  const [sellPrice, setSellPrice] = useState(3);
  const [tradeMsg, setTradeMsg] = useState(null);   // { ok, text }
  const [tradeBusy, setTradeBusy] = useState(false);

  const isLive = !!(socket && roomCode && teamId) && !practiceMode;

  // Snapshot fetch + subscribe to updates (skipped in practice mode —
  // we manage state locally so a solo player can interact end-to-end).
  useEffect(() => {
    if (!isLive) return;
    let cancelled = false;
    socket.emit("quest:requestState", { roomCode, teamId }, (resp) => {
      if (cancelled || !resp?.ok) return;
      setState(resp.state || null);
    });
    const onUpdate = (s) => { if (!cancelled && s) setState(s); };
    socket.on("quest:stateUpdated", onUpdate);
    return () => { cancelled = true; socket.off("quest:stateUpdated", onUpdate); };
  }, [isLive, socket, roomCode, teamId]);

  const inv = state?.inventory && typeof state.inventory === "object" ? state.inventory : {};
  const coins = Number(state?.coins) || 0;

  // Compute objective progress
  const objectivesProgress = useMemo(() => {
    return objectives.map((o, i) => {
      const req = (o && o.requiredResources) || {};
      const lines = Object.entries(req).map(([rid, need]) => ({
        rid,
        need: Number(need) || 0,
        have: Number(inv[rid]) || 0,
      }));
      const allMet = lines.every((l) => l.have >= l.need);
      return { ...o, idx: i, lines, allMet };
    });
  }, [objectives, inv]);

  const allObjectivesMet = objectivesProgress.length > 0 && objectivesProgress.every((o) => o.allMet);

  const handleBuy = (resourceId) => {
    // Practice mode: simulate the buy entirely client-side so the
    // player can experience the mechanic without a live socket session.
    if (practiceMode) {
      const r = resources.find((x) => x.id === resourceId);
      const coinOpt = (r?.acquisitionOptions || []).find((o) => o?.type === "coins");
      const cost = Number(coinOpt?.amount) || 0;
      const have = Number(state?.coins) || 0;
      if (have < cost) {
        setError(`Not enough coins (need ${cost}, have ${have}).`);
        return;
      }
      setState((prev) => ({
        ...(prev || { coins: PRACTICE_STARTER_COINS, inventory: {} }),
        coins: (Number(prev?.coins) || 0) - cost,
        inventory: {
          ...(prev?.inventory || {}),
          [resourceId]: (Number(prev?.inventory?.[resourceId]) || 0) + 1,
        },
      }));
      setError(null);
      return;
    }

    if (!isLive) return;
    setBusyResId(resourceId);
    setError(null);
    socket.emit(
      "quest:acquireResource",
      { roomCode, teamId, taskIndex, resourceId, quantity: 1 },
      (resp) => {
        setBusyResId(null);
        if (!resp?.ok) {
          setError(resp?.error || "Could not acquire.");
        } else if (resp.state) {
          setState(resp.state);
        }
      },
    );
  };

  // Seller side: when a buyer scans our offer, the server tells us the sale
  // completed so we can celebrate it (state is refreshed via quest:stateUpdated).
  useEffect(() => {
    if (!isLive) return;
    const onSold = (info) => {
      if (!info) return;
      setTradeMsg({ ok: true, text: `💰 Sold ${info.quantity}× ${info.resourceId} for ${info.price} coin${info.price === 1 ? "" : "s"}!` });
    };
    socket.on("quest:tradeCompleted", onSold);
    return () => socket.off("quest:tradeCompleted", onSold);
  }, [isLive, socket]);

  // Resources this team actually holds (sellable).
  const ownedResources = useMemo(
    () => resources.filter((r) => (Number(inv[r.id]) || 0) > 0),
    [resources, inv]
  );

  // Fair-value anchor for a resource = its supply-depot coin price (falls back
  // to 3 when the resource has no coin option). Sellers start here, then adjust.
  const anchorPriceFor = (resId) => {
    const r = resources.find((x) => x.id === resId);
    const coinOpt = (r?.acquisitionOptions || []).find((o) => o?.type === "coins");
    const amt = Number(coinOpt?.amount);
    return Number.isFinite(amt) && amt > 0 ? Math.floor(amt) : 3;
  };

  // The offer encoded into the QR the buyer scans.
  const offerQrValue = useMemo(() => {
    if (!sellResId) return "";
    return JSON.stringify({
      v: 1,
      t: "quest-trade",
      roomCode: roomCode || "",
      sellerTeamId: teamId || "",
      resourceId: sellResId,
      quantity: 1,
      price: Math.max(0, Math.floor(Number(sellPrice) || 0)),
    });
  }, [sellResId, sellPrice, roomCode, teamId]);

  // Buyer side: parse a scanned offer and execute the trade. Returns true to
  // stop the scanner once we've handled a valid (or definitively invalid) code.
  const handleScan = (raw) => {
    let offer;
    try { offer = JSON.parse(String(raw || "")); } catch { offer = null; }
    if (!offer || offer.t !== "quest-trade" || !offer.resourceId || !offer.sellerTeamId) {
      setTradeMsg({ ok: false, text: "That isn't a Quest trade code — scan a teammate's offer QR." });
      return false; // keep scanning
    }
    const qty = Math.max(1, Math.floor(Number(offer.quantity) || 1));
    const cost = Math.max(0, Math.floor(Number(offer.price) || 0));

    // Practice / no live session → simulate the trade locally so the mechanic
    // is fully demoable on one device.
    if (practiceMode || !isLive) {
      const have = Number(state?.coins) || 0;
      if (have < cost) { setTradeMsg({ ok: false, text: `Not enough coins (need ${cost}, have ${have}).` }); return true; }
      setState((prev) => ({
        ...(prev || { coins: 0, inventory: {} }),
        coins: (Number(prev?.coins) || 0) - cost,
        inventory: { ...(prev?.inventory || {}), [offer.resourceId]: (Number(prev?.inventory?.[offer.resourceId]) || 0) + qty },
      }));
      setTradeMsg({ ok: true, text: `Acquired ${qty}× ${offer.resourceId} for ${cost} coins (practice).` });
      setTradeMode(null);
      return true;
    }

    if (String(offer.sellerTeamId) === String(teamId)) {
      setTradeMsg({ ok: false, text: "That's your own team's offer." });
      return true;
    }

    setTradeBusy(true);
    socket.emit("quest:trade", { roomCode, buyerTeamId: teamId, offer }, (resp) => {
      setTradeBusy(false);
      if (!resp?.ok) { setTradeMsg({ ok: false, text: resp?.error || "Trade failed." }); return; }
      if (resp.state) setState(resp.state);
      setTradeMsg({ ok: true, text: `Acquired ${qty}× ${offer.resourceId}!` });
      setTradeMode(null);
    });
    return true; // stop scanning after a valid offer
  };

  const handleLaunch = () => {
    if (onSubmit) {
      onSubmit({
        type: "quest-launch",
        completedObjectives: objectivesProgress.filter((o) => o.allMet).map((o) => o.id),
        autoComplete: true,
      });
    }
  };

  /* ──────────────── Render ──────────────── */
  return (
    <div style={wrap}>
      <div style={tagStrip}>Mission</div>
      <div style={titleStyle}>{cfg.title || task?.title || "The Quest"}</div>
      {cfg.scenario ? <p style={scenarioStyle}>{cfg.scenario}</p> : null}

      {/* Practice-mode instructions — explains the economy. Tester
          (Gavy, May 2026) tried this in solo demo with 0 coins and
          couldn't tell how to interact. */}
      {practiceMode && (
        <div
          style={{
            margin: "8px 0 4px",
            padding: "10px 12px",
            borderRadius: 10,
            background: "rgba(124,58,237,0.15)",
            border: "1px solid rgba(124,58,237,0.45)",
            color: "#e9d5ff",
            fontSize: "0.85rem",
            lineHeight: 1.45,
            fontWeight: 500,
          }}
        >
          🎯 <strong>Practice run.</strong> You start with {PRACTICE_STARTER_COINS} coins.
          Tap <em>Buy</em> on resources below to fill the objectives. In a real session
          you earn coins by completing other tasks and can trade with other teams.
        </div>
      )}

      {/* Objectives panel */}
      {objectivesProgress.length > 0 && (
        <div style={cardWrap}>
          <div style={cardLabel}>Objectives</div>
          {objectivesProgress.map((o) => (
            <div key={o.id || o.idx} style={{ marginTop: 8 }}>
              <div style={{ fontSize: "0.95rem", color: "#f1f5f9" }}>{o.description}</div>
              {o.lines.length === 0 ? (
                <div style={{ fontSize: "0.8rem", color: "#94a3b8" }}>No resource requirements.</div>
              ) : (
                <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {o.lines.map((l) => (
                    <span key={l.rid} style={{ ...invChipStyle, opacity: l.have >= l.need ? 1 : 0.65 }}>
                      {l.rid}: <strong style={{ marginLeft: 4 }}>{l.have}</strong> / {l.need}
                      {l.have >= l.need ? " ✓" : ""}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Resource shop */}
      {resources.length > 0 && (
        <div style={cardWrap}>
          <div style={cardLabel}>Supply depot</div>
          <div style={{ fontSize: "0.78rem", color: "#cbd5e1", marginBottom: 8 }}>
            Earn coins by completing tasks, then spend them here.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {resources.map((r) => {
              const coinOpt = (r.acquisitionOptions || []).find((o) => o?.type === "coins");
              const cost = Number(coinOpt?.amount) || 0;
              const canAfford = coins >= cost;
              const have = Number(inv[r.id]) || 0;
              return (
                <div key={r.id} style={resourceRow}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "0.95rem", fontWeight: 600, color: "#f1f5f9" }}>
                      {r.name || r.id}
                      {have > 0 && <span style={{ fontSize: "0.78rem", marginLeft: 6, color: "#bbf7d0" }}>×{have}</span>}
                    </div>
                    {cost > 0 ? (
                      <div style={{ fontSize: "0.72rem", color: "#cbd5e1" }}>{cost} coin{cost === 1 ? "" : "s"}</div>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleBuy(r.id)}
                    disabled={disabled || (!isLive && !practiceMode) || !canAfford || busyResId === r.id}
                    style={{
                      ...buyBtn,
                      background: !canAfford ? "rgba(75,85,99,0.4)" : busyResId === r.id ? "#7c3aed88" : "#7c3aed",
                      cursor: !canAfford || busyResId === r.id ? "not-allowed" : "pointer",
                      opacity: !canAfford ? 0.55 : 1,
                    }}
                  >
                    {busyResId === r.id ? "…" : "Buy"}
                  </button>
                </div>
              );
            })}
          </div>
          {error ? <div style={errStyle}>{error}</div> : null}
        </div>
      )}

      {/* Trade with another team — show a QR to sell, or scan one to buy. */}
      <div style={cardWrap}>
        <div style={cardLabel}>Trade with another team</div>
        <div style={{ fontSize: "0.78rem", color: "#cbd5e1", marginBottom: 8 }}>
          Go to another team to swap supplies: <strong>show your QR to sell</strong> a resource for coins,
          or <strong>scan their QR to buy</strong> one.
        </div>

        {!tradeMode && (
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              style={{ ...buyBtn, background: "#0ea5e9", flex: 1, minWidth: 0 }}
              disabled={disabled}
              onClick={() => {
                setTradeMsg(null);
                const first = ownedResources[0]?.id || "";
                setSellResId(first);
                if (first) setSellPrice(anchorPriceFor(first));
                setTradeMode("sell");
              }}
            >
              Make an offer
            </button>
            <button
              type="button"
              style={{ ...buyBtn, background: "#22c55e", flex: 1, minWidth: 0 }}
              disabled={disabled}
              onClick={() => { setTradeMsg(null); setTradeMode("buy"); }}
            >
              Scan to buy
            </button>
          </div>
        )}

        {tradeMode === "sell" && (
          <div>
            {ownedResources.length === 0 ? (
              <div style={{ fontSize: "0.82rem", color: "#fca5a5" }}>
                You have no resources to sell yet — acquire some first.
              </div>
            ) : (
              <>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
                  <select
                    value={sellResId}
                    onChange={(e) => { const id = e.target.value; setSellResId(id); setSellPrice(anchorPriceFor(id)); }}
                    style={selectStyle}
                  >
                    {ownedResources.map((r) => (
                      <option key={r.id} value={r.id}>{(r.name || r.id)} (×{Number(inv[r.id]) || 0})</option>
                    ))}
                  </select>
                  <label style={{ fontSize: "0.8rem", color: "#cbd5e1", display: "inline-flex", alignItems: "center", gap: 4 }}>
                    Price
                    <input
                      type="number"
                      min={0}
                      value={sellPrice}
                      onChange={(e) => setSellPrice(e.target.value)}
                      style={priceInput}
                    />
                    coins
                  </label>
                </div>
                {sellResId && (
                  <div style={{ fontSize: "0.72rem", color: "#94a3b8", marginBottom: 6 }}>
                    Standard value: {anchorPriceFor(sellResId)} coin{anchorPriceFor(sellResId) === 1 ? "" : "s"} — adjust the price to negotiate.
                  </div>
                )}
                {offerQrValue && (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, background: "#fff", padding: 12, borderRadius: 12 }}>
                    <QRCodeSVG value={offerQrValue} size={184} marginSize={2} />
                    <div style={{ fontSize: "0.78rem", color: "#0f172a", fontWeight: 700, textAlign: "center" }}>
                      Show this to the buyer — they scan it to pay {Math.max(0, Math.floor(Number(sellPrice) || 0))} coin
                      {Math.max(0, Math.floor(Number(sellPrice) || 0)) === 1 ? "" : "s"} for 1× {sellResId}.
                    </div>
                  </div>
                )}
              </>
            )}
            <button type="button" style={{ ...buyBtn, background: "rgba(75,85,99,0.6)", marginTop: 8 }} onClick={() => setTradeMode(null)}>
              Done
            </button>
          </div>
        )}

        {tradeMode === "buy" && (
          <div>
            <div style={{ fontSize: "0.78rem", color: "#cbd5e1", marginBottom: 6 }}>
              Point your camera at the seller's QR{tradeBusy ? " — processing…" : "."}
            </div>
            <QrScanner active onCode={handleScan} />
            <button type="button" style={{ ...buyBtn, background: "rgba(75,85,99,0.6)", marginTop: 8 }} onClick={() => setTradeMode(null)}>
              Cancel
            </button>
          </div>
        )}

        {tradeMsg && <div style={tradeMsg.ok ? okStyle : errStyle}>{tradeMsg.text}</div>}
      </div>

      {/* Launch button */}
      <button
        type="button"
        onClick={handleLaunch}
        disabled={disabled || !allObjectivesMet}
        style={{
          ...launchBtn,
          background: allObjectivesMet ? "linear-gradient(135deg, #22c55e, #16a34a)" : "rgba(75,85,99,0.4)",
          cursor: allObjectivesMet ? "pointer" : "not-allowed",
          opacity: allObjectivesMet ? 1 : 0.55,
        }}
      >
        {allObjectivesMet ? "Launch Mission →" : "Gather supplies to launch"}
      </button>

      {ranks.length > 0 && (
        <div style={{ fontSize: "0.72rem", color: "#94a3b8", marginTop: 4 }}>
          Ranks: {ranks.map((r) => r.label).join(" → ")}
        </div>
      )}
    </div>
  );
}

/* ──────────────── Styles ──────────────── */
const wrap = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
  padding: "14px 14px",
  width: "100%",
  maxWidth: 560,
  margin: "0 auto",
};
const tagStrip = {
  fontSize: "0.65rem",
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: 1.5,
  color: "#fde68a",
  alignSelf: "flex-start",
  padding: "2px 8px",
  background: "rgba(251,191,36,0.18)",
  borderRadius: 999,
};
const titleStyle = { fontSize: "1.6rem", fontWeight: 800, color: "#f1f5f9" };
const scenarioStyle = {
  fontSize: "0.95rem",
  color: "#cbd5e1",
  lineHeight: 1.5,
  margin: 0,
};
const cardWrap = {
  padding: 12,
  background: "rgba(30,41,59,0.55)",
  border: "1px solid rgba(124,58,237,0.35)",
  borderRadius: 12,
};
const cardLabel = {
  fontSize: "0.72rem",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: 1.5,
  color: "#a78bfa",
  marginBottom: 4,
};
const invChipStyle = {
  fontSize: "0.78rem",
  padding: "2px 8px",
  borderRadius: 999,
  background: "rgba(34,197,94,0.12)",
  border: "1px solid rgba(34,197,94,0.35)",
  color: "#bbf7d0",
  fontVariantNumeric: "tabular-nums",
};
const resourceRow = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "6px 10px",
  background: "rgba(15,23,42,0.5)",
  borderRadius: 10,
};
const buyBtn = {
  padding: "6px 14px",
  fontSize: "0.85rem",
  fontWeight: 700,
  border: "none",
  borderRadius: 8,
  color: "#fff",
  minWidth: 60,
};
const launchBtn = {
  padding: "12px 28px",
  fontSize: "1rem",
  fontWeight: 700,
  border: "none",
  borderRadius: 14,
  color: "#fff",
  marginTop: 4,
};
const errStyle = {
  fontSize: "0.8rem",
  color: "#fca5a5",
  background: "rgba(239,68,68,0.10)",
  border: "1px solid rgba(239,68,68,0.35)",
  borderRadius: 8,
  padding: "6px 10px",
  marginTop: 8,
};
const okStyle = {
  fontSize: "0.8rem",
  color: "#bbf7d0",
  background: "rgba(34,197,94,0.12)",
  border: "1px solid rgba(34,197,94,0.4)",
  borderRadius: 8,
  padding: "6px 10px",
  marginTop: 8,
};
const selectStyle = {
  flex: 1,
  minWidth: 140,
  padding: "8px 10px",
  borderRadius: 8,
  background: "rgba(15,23,42,0.7)",
  color: "#f1f5f9",
  border: "1px solid rgba(124,58,237,0.45)",
  fontSize: "0.85rem",
};
const priceInput = {
  width: 64,
  padding: "6px 8px",
  borderRadius: 8,
  background: "rgba(15,23,42,0.7)",
  color: "#f1f5f9",
  border: "1px solid rgba(124,58,237,0.45)",
  fontSize: "0.85rem",
};
