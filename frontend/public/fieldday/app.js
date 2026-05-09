/* ============================================================
 * Field Day — UI controller
 *
 * All persistence and remote sync goes through window.FieldDayAPI
 * (see api.js). This file holds only UI state, rendering, and
 * event wiring.
 * ============================================================ */

(() => {
  "use strict";

  const api = window.FieldDayAPI;
  if (!api) { console.error("FieldDayAPI not loaded"); return; }

  // ---------- Constants ----------
  const PLACE_POINTS = { 1: 5, 2: 4, 3: 3, 4: 2 };
  const COMPLETION_POINTS = 1;
  const POLL_MS = 6000;
  // While a leader is in the event-detail screen we poll faster so other
  // helpers' Start/Stop actions show up promptly. fetchState is cheap
  // (single doc read), and 1.5s is comfortable for hand-timing latency.
  const POLL_MS_EVENT = 1500;

  // ---------- App state (in-memory cache; server is source of truth) ----------
  /** @type {{school: object|null, events: object[], announceQueue: string[]}} */
  let state = { school: null, events: [], announceQueue: [] };

  // Transient UI state
  let currentEventId = null;
  let timerHandle = null;
  let timerStart = 0;
  let timerTarget = null;
  let authStep = "email";
  let pendingEmail = "";
  let pendingDevPasskey = null; // for local-mode passkey display
  let stopPoll = null;

  // ---------- Helpers ----------
  function uid() { return Math.random().toString(36).slice(2, 10); }
  function escapeHtml(s){ return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])); }
  function $(sel, root=document) { return root.querySelector(sel); }
  function $$(sel, root=document) { return [...root.querySelectorAll(sel)]; }
  function genCode() { return "FIELD" + Math.floor(10 + Math.random()*90); }

  /**
   * Computes a person's age on the school's cutoff date (default Dec 31)
   * of the current calendar year.
   * @param {string} dob — ISO date "YYYY-MM-DD"
   * @param {string} cutoff — "MM-DD"
   * @returns {number|null}
   */
  function computeAge(dob, cutoff = "12-31") {
    if (!dob) return null;
    const dobDate = new Date(String(dob) + "T00:00:00");
    if (isNaN(dobDate.getTime())) return null;
    const [mm, dd] = String(cutoff || "12-31").split("-").map(n => parseInt(n, 10));
    const yr = new Date().getFullYear();
    const cutoffDate = new Date(yr, (mm||12) - 1, dd || 31);
    let age = cutoffDate.getFullYear() - dobDate.getFullYear();
    if (cutoffDate.getMonth() < dobDate.getMonth() ||
        (cutoffDate.getMonth() === dobDate.getMonth() && cutoffDate.getDate() < dobDate.getDate())) age--;
    return age >= 0 ? age : null;
  }
  function getSchool() { return state.school; }
  function isAdmin() { return api.getSession()?.role === "admin"; }

  /**
   * Returns true if the current user is allowed to Start All / Reset All /
   * start individual row timers in the given event. Mirrors the backend
   * canStartOrReset() logic so the UI matches authorization.
   *
   *   - admin: always yes
   *   - school.restrictTimerStarts off: any signed-in helper, yes
   *   - school.restrictTimerStarts on:  only the event's assigned leader
   */
  function canStartOrResetTimers(ev) {
    if (!ev) return false;
    if (isAdmin()) return true;
    if (!state.school?.restrictTimerStarts) return true;
    const sessLeader = (api.getSession()?.leaderName || "").trim().toLowerCase();
    const evLeader   = (ev.leaderName || "").trim().toLowerCase();
    return !!sessLeader && sessLeader === evLeader;
  }
  /**
   * In-app form modal — replaces window.prompt() (which always shows an
   * ugly "www.curriculate.net says" header). Returns a Promise that
   * resolves to a {field: value} object on Save, or null on Cancel.
   *
   * Usage:
   *   const out = await showFormModal({
   *     title: "Edit Maya Patel",
   *     fields: [
   *       { name: "bib",   label: "Bib / race number",   value: c.bib,   placeholder: "42" },
   *       { name: "grade", label: "Grade",               value: c.grade, placeholder: "3" },
   *     ],
   *     submitLabel: "Save"
   *   });
   *   if (out) { c.bib = out.bib; c.grade = out.grade; }
   */
  function showFormModal({ title, fields, submitLabel = "Save", cancelLabel = "Cancel", body = "" }) {
    return new Promise((resolve) => {
      $("#formModalTitle").textContent = title || "Edit";
      const fieldsHtml = (fields || []).map((f, i) => `
        <div class="form-row">
          <label>${escapeHtml(f.label || f.name)}</label>
          <input data-fm-name="${escapeHtml(f.name)}"
                 ${f.type === "radio" ? "" : `type="${escapeHtml(f.type || "text")}"`}
                 ${f.maxLength ? `maxlength="${f.maxLength}"` : ""}
                 ${f.inputmode ? `inputmode="${escapeHtml(f.inputmode)}"` : ""}
                 value="${escapeHtml(f.value ?? "")}"
                 placeholder="${escapeHtml(f.placeholder || "")}"
                 ${i === 0 ? "data-fm-autofocus" : ""} />
          ${f.help ? `<p class="muted small">${escapeHtml(f.help)}</p>` : ""}
        </div>
      `).join("");
      $("#formModalBody").innerHTML = (body ? `<p class="muted small">${escapeHtml(body)}</p>` : "") + fieldsHtml;
      $("#formModalOk").textContent = submitLabel;
      $("#formModalCancel").textContent = cancelLabel;
      $("#formModal").hidden = false;
      const focusEl = $("#formModalBody [data-fm-autofocus]");
      if (focusEl) setTimeout(() => focusEl.focus(), 30);

      const cleanup = () => {
        $("#formModal").hidden = true;
        $("#formModalBody").innerHTML = "";
        $("#formModalOk").onclick = null;
        $("#formModalCancel").onclick = null;
        $("#formModalClose").onclick = null;
        $("#formModalBody").onkeydown = null;
      };
      $("#formModalOk").onclick = () => {
        const out = {};
        $$("#formModalBody [data-fm-name]").forEach(el => { out[el.dataset.fmName] = el.value.trim(); });
        cleanup();
        resolve(out);
      };
      $("#formModalCancel").onclick = () => { cleanup(); resolve(null); };
      $("#formModalClose").onclick  = () => { cleanup(); resolve(null); };
      $("#formModalBody").onkeydown = (e) => { if (e.key === "Enter") $("#formModalOk").click(); };
    });
  }

  /**
   * Per-attempt "which results do you want to clear?" modal. Shows one
   * checkbox per filled attempt + an "All attempts" master toggle. Resolves
   * to an array of attempt indices to clear, or null on Cancel.
   */
  function showAttemptClearModal(name, filled, ev) {
    return new Promise((resolve) => {
      $("#formModalTitle").textContent = `Clear results for ${name}?`;
      const rowsHtml = filled.map(({ v, i }) => `
        <label class="form-row" style="display:flex;align-items:center;gap:10px;padding:8px;border:1px solid var(--line);border-radius:8px;cursor:pointer;margin:6px 0;">
          <input type="checkbox" data-aclear-idx="${i}" />
          <span><strong>Attempt ${i+1}:</strong> ${escapeHtml(displayAttempt(v, ev.type))}${ev.unit && ev.type !== "timed" ? " " + escapeHtml(ev.unit) : ""}</span>
        </label>
      `).join("");
      $("#formModalBody").innerHTML = `
        <p class="muted small">Pick which attempts to wipe. The competitor stays in the event — only the numbers are reset.</p>
        ${rowsHtml}
        <label class="form-row" style="display:flex;align-items:center;gap:10px;padding:8px;border-top:1px dashed var(--line);margin-top:8px;cursor:pointer;">
          <input type="checkbox" data-aclear-all />
          <span><strong>All attempts</strong></span>
        </label>
      `;
      $("#formModalOk").textContent = "Clear selected";
      $("#formModalCancel").textContent = "Cancel";
      $("#formModal").hidden = false;

      // "All" toggles every checkbox at once.
      const all = $("#formModalBody [data-aclear-all]");
      const boxes = $$("#formModalBody [data-aclear-idx]");
      all.addEventListener("change", () => boxes.forEach(b => { b.checked = all.checked; }));
      boxes.forEach(b => b.addEventListener("change", () => {
        all.checked = boxes.every(x => x.checked);
      }));

      const cleanup = () => {
        $("#formModal").hidden = true;
        $("#formModalBody").innerHTML = "";
        $("#formModalOk").onclick = null;
        $("#formModalCancel").onclick = null;
        $("#formModalClose").onclick = null;
      };
      $("#formModalOk").onclick = () => {
        const picks = $$("#formModalBody [data-aclear-idx]")
          .filter(b => b.checked)
          .map(b => parseInt(b.dataset.aclearIdx, 10));
        cleanup();
        if (picks.length === 0) { showToast("Nothing selected"); resolve(null); return; }
        resolve(picks);
      };
      $("#formModalCancel").onclick = () => { cleanup(); resolve(null); };
      $("#formModalClose").onclick  = () => { cleanup(); resolve(null); };
    });
  }

  function showToast(msg, ms=2200) {
    const el = $("#toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => { el.hidden = true; }, ms);
  }
  /**
   * Like showToast, but appends an "Undo" button. The toast stays visible
   * for `ms` (default 15s — destructive ops deserve a generous window) or
   * until the user clicks Undo. If clicked, undoFn() runs and a small
   * confirmation toast replaces the undo prompt.
   */
  function showUndoToast(msg, undoFn, ms=15000) {
    const el = $("#toast");
    el.innerHTML = `<span style="margin-right:14px">${escapeHtml(msg)}</span>
      <button id="toastUndoBtn" style="background:#ffd166;color:#1c1c1c;border:0;padding:6px 14px;border-radius:999px;font-weight:700;cursor:pointer;font-size:13px;">Undo</button>`;
    el.hidden = false;
    clearTimeout(showToast._t);
    let used = false;
    const cleanup = () => { el.hidden = true; el.innerHTML = ""; };
    document.getElementById("toastUndoBtn").addEventListener("click", async () => {
      if (used) return; used = true;
      clearTimeout(showToast._t);
      cleanup();
      try { await undoFn(); showToast("Undone"); }
      catch (e) { showToast("Undo failed"); }
    });
    showToast._t = setTimeout(() => { if (!used) cleanup(); }, ms);
  }
  function fmtTimer(ms) {
    if (ms == null || isNaN(ms)) return "--";
    const sign = ms < 0 ? "-" : ""; ms = Math.abs(ms);
    const mins = Math.floor(ms/60000);
    const secs = Math.floor((ms%60000)/1000);
    const cs = Math.floor((ms%1000)/10);
    return `${sign}${String(mins).padStart(2,"0")}:${String(secs).padStart(2,"0")}.${String(cs).padStart(2,"0")}`;
  }
  function fmtResult(value, type, unit) {
    if (value == null || value === "") return "—";
    // Timed values are stored as **seconds** (matches displayAttempt /
    // parseAttemptInput / stopRowTimer / stopTimer). fmtTimer expects ms,
    // so multiply by 1000. (Previously had ×10 which mis-displayed every
    // standing/ribbon/summary time as a tiny fraction of the real value.)
    if (type === "timed") return fmtTimer(Number(value) * 1000);
    const v = Number(value);
    return `${v % 1 === 0 ? v : v.toFixed(2)}${unit ? " " + unit : ""}`;
  }
  function bestOf(attempts, type) {
    const nums = (attempts||[]).filter(v => v != null && !isNaN(v) && v !== "").map(Number);
    if (!nums.length) return null;
    return type === "timed" ? Math.min(...nums) : Math.max(...nums);
  }
  function compareResults(a, b, type) {
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    return type === "timed" ? a - b : b - a;
  }

  // ---------- Audio: horn fanfare for record breaks ----------
  let _audioCtx = null;
  function getAudioCtx() {
    if (!_audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      _audioCtx = new Ctx();
    }
    if (_audioCtx.state === "suspended") _audioCtx.resume();
    return _audioCtx;
  }
  /** Plays a 3-note rising fanfare. Call from a user-gesture handler ideally. */
  function playHorn() {
    const ctx = getAudioCtx(); if (!ctx) return;
    const now = ctx.currentTime;
    // Bb major-ish triumphal triad: G4 → C5 → E5 → G5 sustained
    const notes = [
      { f: 392.0, t: 0.00, d: 0.18 },
      { f: 523.3, t: 0.18, d: 0.18 },
      { f: 659.3, t: 0.36, d: 0.18 },
      { f: 783.99,t: 0.54, d: 0.85 },
    ];
    notes.forEach(n => {
      const o = ctx.createOscillator();
      const o2 = ctx.createOscillator();
      const g = ctx.createGain();
      o.type  = "sawtooth";
      o2.type = "square";
      o.frequency.value  = n.f;
      o2.frequency.value = n.f * 2;     // octave overtone for brassy timbre
      g.gain.value = 0;
      g.gain.setValueAtTime(0, now + n.t);
      g.gain.linearRampToValueAtTime(0.22, now + n.t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, now + n.t + n.d);
      o.connect(g); o2.connect(g); g.connect(ctx.destination);
      o.start(now + n.t);  o.stop(now + n.t + n.d + 0.05);
      o2.start(now + n.t); o2.stop(now + n.t + n.d + 0.05);
    });
  }

  // ---------- Confetti + record-break celebration ----------
  function spawnConfetti() {
    const wrap = $("#confetti");
    if (!wrap) return;
    wrap.innerHTML = "";
    const colors = ["#ffd166","#ef476f","#06d6a0","#118ab2","#f78c6b","#ffeb99","#a6f1c1"];
    for (let i = 0; i < 90; i++) {
      const piece = document.createElement("i");
      piece.style.setProperty("--c", colors[i % colors.length]);
      piece.style.setProperty("--d", (2 + Math.random()*2.5).toFixed(2) + "s");
      piece.style.setProperty("--delay", (Math.random()*0.6).toFixed(2) + "s");
      piece.style.setProperty("--r", (Math.random()*360) + "deg");
      piece.style.left = (Math.random()*100) + "%";
      piece.style.background = colors[i % colors.length];
      wrap.appendChild(piece);
    }
  }
  // Queue celebrations that arrive while a timer is running so the timing
  // session isn't interrupted. Drained when stopTimer() / resetTimer() are called.
  const pendingCelebrations = [];
  function showRecordCelebration(payload) {
    if (anyTimerRunning && anyTimerRunning()) {
      pendingCelebrations.push(payload);
      showToast(`🎺 New record by ${payload.name} — celebration queued`);
      return;
    }
    _renderCelebration(payload);
  }
  function _renderCelebration({ event, name, result, prev }) {
    $("#celebrationEvent").textContent = event;
    $("#celebrationName").textContent  = name;
    $("#celebrationResult").textContent = result;
    $("#celebrationPrev").textContent  = prev ? `Previous record: ${prev}` : `First school record set!`;
    $("#celebration").hidden = false;
    spawnConfetti();
    try { playHorn(); } catch (e) {}
  }
  function dismissCelebration() {
    $("#celebration").hidden = true;
    $("#confetti").innerHTML = "";
    // Drain any queued celebrations one at a time (waits for user to dismiss each).
    if (pendingCelebrations.length > 0) {
      const next = pendingCelebrations.shift();
      setTimeout(() => _renderCelebration(next), 200);
    }
  }
  function drainCelebrationsAfterTimer() {
    if (pendingCelebrations.length === 0) return;
    const next = pendingCelebrations.shift();
    setTimeout(() => _renderCelebration(next), 300);
  }

  /**
   * After a competitor's attempts change, check if any of their attempts beats the
   * current school record for (event title, age, gender). If so, record it locally,
   * fire the horn + celebration, and persist via the API.
   */
  async function checkForRecordBreak(ev, competitor) {
    if (!ev || !competitor || !state.school) return;
    const current = bestOf(competitor.attempts, ev.type);
    if (current == null) return;
    const records = state.school.records || [];
    const existing = records.find(r =>
      (r.title || "").toLowerCase() === (ev.title||"").toLowerCase() &&
      String(r.age) === String(ev.age) &&
      r.gender === ev.gender
    );
    const beats = existing
      ? compareResults(current, existing.value, ev.type) < 0   // strictly better
      : true; // first-ever record for this event/age/gender combo
    if (!beats) return;
    const newRec = {
      title: ev.title, age: ev.age, gender: ev.gender, type: ev.type, unit: ev.unit,
      value: current,
      holderName: competitor.name,
      dateSet: new Date().toISOString().slice(0,10),
      eventId: ev.id,
      competitorId: competitor.id,
      wind: ev.wind != null ? Number(ev.wind) : null,
      windAided: ev.wind != null && Number(ev.wind) > 2.0
    };
    try {
      let resp;
      if (existing) {
        resp = await api.updateRecord(existing.id, newRec);
        // replace the existing record in cache
        const idx = state.school.records.findIndex(r => r.id === existing.id);
        if (idx >= 0 && resp?.record) state.school.records[idx] = resp.record;
      } else {
        resp = await api.createRecord(newRec);
        if (!state.school.records) state.school.records = [];
        if (resp?.record) state.school.records.push(resp.record);
      }
      showRecordCelebration({
        event: `${ev.title} · Age ${ev.age} ${ev.gender}`,
        name:  competitor.name,
        result: fmtResult(current, ev.type, ev.unit),
        prev:  existing ? fmtResult(existing.value, ev.type, ev.unit) + ` (${existing.holderName||"—"})` : ""
      });
    } catch (e) {
      console.warn("record save failed", e);
    }
  }

  // ---------- State refresh ----------
  async function refreshState() {
    try {
      const s = await api.fetchState();
      state = { school: s.school, events: s.events || [], announceQueue: s.announceQueue || [] };
    } catch (e) {
      // leave cached state in place; caller may toast
      console.warn("[fieldday] refreshState failed:", e);
    }
  }

  function applyEntityUpdate(updated) {
    if (!updated) return;
    if (updated.event) {
      const idx = state.events.findIndex(e => e.id === updated.event.id);
      if (idx >= 0) state.events[idx] = updated.event;
      else state.events.push(updated.event);
    }
    if (updated.school) state.school = updated.school;
  }

  // ---------- Refresh resilience: persist UI state across reloads ----------
  // Each piece is independent of session token (so a leader who refreshes
  // mid-race lands back on the right event with their timers still running
  // against the original start time).
  const UI_STATE_KEY = "fielddayUiState";
  function saveUiState(patch) {
    try {
      const cur = JSON.parse(localStorage.getItem(UI_STATE_KEY) || "{}");
      const next = Object.assign(cur, patch);
      localStorage.setItem(UI_STATE_KEY, JSON.stringify(next));
    } catch (e) { /* quota / private mode — silent */ }
  }
  function readUiState() {
    try { return JSON.parse(localStorage.getItem(UI_STATE_KEY) || "{}"); }
    catch (e) { return {}; }
  }
  function clearUiState() {
    try { localStorage.removeItem(UI_STATE_KEY); } catch (e) {}
  }

  // ---------- Routing ----------
  const VIEWS = ["events","admin","ribbons","announce","settings"];
  function setView(v) {
    VIEWS.forEach(name => {
      const el = $(`#view-${name}`);
      if (el) el.hidden = (name !== v);
    });
    $$(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === v));
    $("#view-event-detail").hidden = true;
    currentEventId = null;
    stopLivePolling();
    saveUiState({ view: v, eventId: null });
    if (v === "events") renderEvents();
    if (v === "admin")  { renderAdmin();   startLivePolling(renderAdmin); }
    if (v === "ribbons") renderRibbons();
    if (v === "announce") { renderAnnounce(); startLivePolling(renderAnnounce); }
    if (v === "settings") renderSettings();
  }

  function startLivePolling(rerender) {
    stopLivePolling();
    stopPoll = api.startPolling((s) => {
      state = { school: s.school || state.school, events: s.events || [], announceQueue: s.announceQueue || [] };
      rerender();
      updateAnnounceBadge();
    }, POLL_MS);
  }
  function stopLivePolling() { if (stopPoll) { stopPoll(); stopPoll = null; } }

  async function showApp() {
    $("#welcomeScreen").hidden = true;
    $("#topbar").hidden = false;
    $("#app").hidden = false;
    await refreshState();
    const session = api.getSession();
    $("#userName").textContent = isAdmin() ? `Admin · ${session?.email || ""}` : (session?.leaderName || "Event Leader");
    $("#userSchool").textContent = state.school ? `${state.school.name} · ${state.school.code}` : "";
    // Show DEMO badge when running off the demo school code (no server saves).
    const demoBadge = $("#demoBadge");
    if (demoBadge) demoBadge.hidden = state.school?.code !== "12345";
    $$(".tab[data-admin='1']").forEach(t => t.hidden = !isAdmin());

    // Restore last view + event detail + any running row-timers (refresh resilience)
    const ui = readUiState();
    const restoreView = (ui.view && (isAdmin() || ui.view === "events")) ? ui.view : "events";
    setView(restoreView);
    if (ui.eventId) {
      const ev = state.events.find(e => e.id === ui.eventId);
      if (ev) {
        await openEventDetail(ui.eventId);
        // Re-attach running timers if their event still matches
        const rt = ui.runningTimers;
        if (rt && rt.eventId === ui.eventId && rt.starts) {
          const epochOffset = Date.now() - performance.now();
          for (const [cid, startEpoch] of Object.entries(rt.starts)) {
            const c = ev.competitors.find(c => c.id === cid);
            if (!c) continue;
            // Convert stored epoch ms back into a performance.now() reference
            const perfStart = Number(startEpoch) - epochOffset;
            startRowTimer(cid, perfStart);
          }
        }
      }
    }
    updateAnnounceBadge();
    updateCompletionBar();
  }

  function showWelcome() {
    stopLivePolling();
    $("#welcomeScreen").hidden = false;
    $("#topbar").hidden = true;
    $("#app").hidden = true;
    $("#completionBar").hidden = true;
  }

  /**
   * Recomputes the completion percentage and updates the fixed bottom bar.
   * For admin: based on every event in the school.
   * For leader: based on events the leader is staff on (and any they created).
   */
  function updateCompletionBar() {
    const session = api.getSession();
    if (!session?.schoolId) { $("#completionBar").hidden = true; return; }
    let events = state.events;
    if (!isAdmin()) {
      const myName = (session.leaderName || "").trim().toLowerCase();
      const staff = state.school?.eventStaff || {};
      events = events.filter(e => {
        if ((e.leaderName||"").trim().toLowerCase() === myName) return true;
        const byDiv = staff[e.title];
        if (!byDiv) return false;
        return Object.values(byDiv).some(byRole =>
          Object.values(byRole||{}).some(n => (n||"").trim().toLowerCase() === myName));
      });
    }
    const total = events.length;
    const done  = events.filter(e => e.status === "completed").length;
    const pct = total === 0 ? 0 : Math.round((done / total) * 100);
    $("#completionBar").hidden = false;
    const fill = $("#completionFill");
    fill.style.width = pct + "%";
    fill.classList.toggle("full", pct === 100 && total > 0);
    $("#completionLabel").textContent = total === 0
      ? "No events yet"
      : `${done} of ${total} events complete · ${pct}%${pct === 100 ? " 🎉" : ""}`;
  }

  // ---------- Auth flows ----------
  function openAdminAuth() {
    authStep = "email";
    pendingEmail = "";
    pendingDevPasskey = null;
    $("#adminEmail").value = "";
    $("#adminPasskey").value = "";
    $("#schoolName").value = "";
    $("#schoolCode").value = "";
    setAdminAuthStep("email");
    $("#adminAuthModal").hidden = false;
  }
  function setAdminAuthStep(step) {
    authStep = step;
    $("#adminStepEmail").hidden = step !== "email";
    $("#adminStepPasskey").hidden = step !== "passkey";
    $("#adminStepSchool").hidden = step !== "school";
    $("#adminStepPickSchool").hidden = step !== "pickSchool";
    $("#adminStepJoinSchool").hidden = step !== "joinSchool";
    $("#btnAdminAuthBack").hidden = step === "email";
    const titleMap = {
      email:"Admin Sign In", passkey:"Enter Passkey",
      school:"Set Up Your School", pickSchool:"Choose School",
      joinSchool:"Join an Existing School"
    };
    $("#adminAuthTitle").textContent = titleMap[step] || "Admin Sign In";
    if (step === "passkey")    setTimeout(() => $("#adminPasskey").focus(),    50);
    if (step === "joinSchool") setTimeout(() => $("#joinSchoolCode").focus(),  50);
  }

  async function adminAuthNext() {
    if (authStep === "email") {
      const email = $("#adminEmail").value.trim().toLowerCase();
      if (!email || !email.includes("@")) { showToast("Enter a valid email"); return; }
      pendingEmail = email;
      $("#btnAdminAuthNext").disabled = true;
      $("#passkeyDisplay").hidden = true;
      $("#passkeyHint").textContent = `Sending passkey to ${email}…`;
      setAdminAuthStep("passkey");
      try {
        const out = await api.requestAdminPasskey(email);
        pendingDevPasskey = out.devPasskey || null;
        $("#passkeyHint").innerHTML =
          `We emailed your passkey to <strong>${escapeHtml(email)}</strong> from <strong>Curriculate Field Day</strong>. ` +
          `Enter the 6-digit code from the email to continue.`;
        // Dev/staging only: backend may echo a passkey for testing
        if (pendingDevPasskey) {
          $("#passkeyShown").textContent = pendingDevPasskey;
          $("#passkeyDisplay").hidden = false;
        }
      } catch (e) {
        showToast("Couldn't request passkey");
        setAdminAuthStep("email");
      } finally {
        $("#btnAdminAuthNext").disabled = false;
      }
      return;
    }

    if (authStep === "passkey") {
      const code = $("#adminPasskey").value.trim();
      if (!code) { showToast("Enter the passkey"); return; }
      $("#btnAdminAuthNext").disabled = true;
      try {
        const out = await api.verifyAdminPasskey(pendingEmail, code);
        if (out.schools && out.schools.length === 1) {
          await api.selectSchool(out.schools[0].id);
          $("#adminAuthModal").hidden = true;
          await showApp();
        } else if (out.schools && out.schools.length > 1) {
          renderSchoolPicker(out.schools);
          setAdminAuthStep("pickSchool");
        } else {
          // No schools yet — show pick-school step with empty list and the
          // "create new" / "join existing" branches both visible as options.
          renderSchoolPicker([]);
          setAdminAuthStep("pickSchool");
        }
      } catch (e) {
        showToast(e.code === 401 ? "Incorrect passkey" : "Sign-in failed");
      } finally {
        $("#btnAdminAuthNext").disabled = false;
      }
      return;
    }

    if (authStep === "joinSchool") {
      const code = $("#joinSchoolCode").value.trim().toUpperCase();
      if (!code) { showToast("Enter the school code"); return; }
      $("#btnAdminAuthNext").disabled = true;
      try {
        await api.joinSchoolAsAdmin(code);
        $("#adminAuthModal").hidden = true;
        await showApp();
        showToast(`Joined ${state.school?.name || "school"} as admin`);
      } catch (e) {
        showToast(e.message === "school_not_found" ? "School code not found" : "Couldn't join school");
      } finally {
        $("#btnAdminAuthNext").disabled = false;
      }
      return;
    }

    if (authStep === "school") {
      const name = $("#schoolName").value.trim();
      const code = $("#schoolCode").value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (!name) { showToast("School name required"); return; }
      if (!code || code.length < 3) { showToast("School code must be 3+ characters"); return; }
      $("#btnAdminAuthNext").disabled = true;
      try {
        await api.createSchool(name, code);
        $("#adminAuthModal").hidden = true;
        await showApp();
        showToast(`Welcome to ${name}`);
      } catch (e) {
        showToast(e.message === "code_taken" ? "That school code is taken" : "Couldn't create school");
      } finally {
        $("#btnAdminAuthNext").disabled = false;
      }
      return;
    }
  }

  function renderSchoolPicker(schools) {
    const list = $("#schoolPickerList");
    if (schools.length === 0) {
      list.innerHTML = `<div class="muted small">You're not yet an admin of any school. Create a new school or join one with a code.</div>`;
    } else {
      list.innerHTML = schools.map(s => `
        <div class="school-pick-item" data-id="${s.id}">
          <div>
            <div><strong>${escapeHtml(s.name)}</strong></div>
          </div>
          <div class="sp-code">${escapeHtml(s.code)}</div>
        </div>
      `).join("");
      list.querySelectorAll(".school-pick-item").forEach(item => {
        item.addEventListener("click", async () => {
          await api.selectSchool(item.dataset.id);
          $("#adminAuthModal").hidden = true;
          await showApp();
        });
      });
    }
  }

  function adminAuthBack() {
    if (authStep === "passkey")    setAdminAuthStep("email");
    else if (authStep === "school") setAdminAuthStep("pickSchool");
    else if (authStep === "joinSchool") setAdminAuthStep("pickSchool");
    else if (authStep === "pickSchool") setAdminAuthStep("passkey");
  }

  function openLeaderAuth() {
    $("#leaderSchoolCode").value = "";
    $("#leaderName").value = "";
    $("#leaderPin") && ($("#leaderPin").value = "");
    $("#leaderPinRow") && ($("#leaderPinRow").hidden = true);
    $("#leaderNameDropdownRow").hidden = true;
    $("#leaderNameTextRow").hidden = false;
    $("#leaderAuthModal").hidden = false;
    setTimeout(() => $("#leaderSchoolCode").focus(), 50);
  }

  async function leaderLookup() {
    const code = $("#leaderSchoolCode").value.trim().toUpperCase();
    if (!code) { showToast("Enter the school code first"); return; }
    $("#btnLeaderLookup").textContent = "Looking up…";
    try {
      const out = await api.lookupSchoolStaff(code);
      const names = out?.staff || [];
      // Show PIN field if the school requires one (demo always does).
      const requiresPin = !!out?.school?.requireLeaderPin || code === "12345";
      $("#leaderPinRow").hidden = !requiresPin;
      if (code === "12345") {
        $("#leaderPin").placeholder = "1234 (demo)";
      }
      if (names.length === 0) {
        showToast("No staff names registered yet — type yours below");
        $("#leaderAuthHint").textContent = "Welcome to " + (out?.school?.name || "the school") + ". Your admin hasn't registered staff yet — type your name.";
        return;
      }
      const sel = $("#leaderNameSelect");
      sel.innerHTML = `<option value="">— pick your name —</option>` + names.map(n => `<option>${escapeHtml(n)}</option>`).join("");
      $("#leaderNameDropdownRow").hidden = false;
      $("#leaderNameTextRow").hidden = true;
      $("#leaderAuthHint").textContent = "Welcome to " + (out?.school?.name || "the school") + (requiresPin ? ". Pick your name and enter your PIN." : ". Pick your name from the list.");
      setTimeout(() => sel.focus(), 30);
    } catch (e) {
      showToast(e.message === "school_not_found" ? "School code not found" : "Lookup failed");
    } finally {
      $("#btnLeaderLookup").textContent = "Look up names →";
    }
  }
  function leaderUseFreeText() {
    $("#leaderNameDropdownRow").hidden = true;
    $("#leaderNameTextRow").hidden = false;
    setTimeout(() => $("#leaderName").focus(), 30);
  }

  async function leaderAuthSubmit() {
    const code = $("#leaderSchoolCode").value.trim().toUpperCase();
    const dropdownVisible = !$("#leaderNameDropdownRow").hidden;
    const name = (dropdownVisible ? $("#leaderNameSelect").value : $("#leaderName").value).trim();
    const pin  = ($("#leaderPin")?.value || "").trim();
    if (!code) { showToast("Enter the school code"); return; }
    if (!name) { showToast("Enter your name"); return; }
    $("#btnLeaderAuthSubmit").disabled = true;
    try {
      await api.joinAsLeader(code, name, pin);
      $("#leaderAuthModal").hidden = true;
      await showApp();
      showToast(`Welcome, ${name}`);
    } catch (e) {
      if (e.message === "school_not_found") showToast("School code not found");
      else if (e.message === "pin_required") showToast("This school requires a PIN — ask your admin");
      else if (e.message === "bad_pin")      showToast("That PIN doesn't match — try again");
      else                                    showToast("Couldn't join school");
    } finally {
      $("#btnLeaderAuthSubmit").disabled = false;
    }
  }

  async function signOut() {
    await api.signOut();
    clearUiState();
    state = { school: null, events: [], announceQueue: [] };
    showWelcome();
  }

  // ---------- Events list ----------
  function renderEvents() {
    if (!isAdmin()) { renderLeaderAssignments(); return; }
    populateAgeFilter();
    const search = $("#eventSearch").value.trim().toLowerCase();
    const fStatus = $("#filterStatus").value;
    const fGender = $("#filterGender").value;
    const fAge = $("#filterAge").value;
    const session = api.getSession();
    let events = [...state.events];
    if (!isAdmin() && session) events = events.filter(e => e.leaderName === session.leaderName);
    if (fStatus) events = events.filter(e => e.status === fStatus);
    if (fGender) events = events.filter(e => e.gender === fGender);
    if (fAge) events = events.filter(e => e.age === fAge);
    if (search) events = events.filter(e => (e.title||"").toLowerCase().includes(search));
    events.sort((a,b) => (b.completedAt||0) - (a.completedAt||0) || (b.createdAt||0) - (a.createdAt||0));

    const grid = $("#eventGrid");
    grid.classList.add("event-grid");
    grid.classList.remove("assignments");
    if (events.length === 0) {
      grid.innerHTML = "";
      $("#eventsEmpty").hidden = false;
    } else {
      $("#eventsEmpty").hidden = true;
      grid.innerHTML = events.map(e => `
        <div class="event-card ${e.status}" data-id="${e.id}">
          <div class="ec-title">${escapeHtml(e.title)}</div>
          <div class="ec-meta">
            <span class="pill">Age ${escapeHtml(e.age)}</span>
            <span class="pill">${escapeHtml(e.gender)}</span>
            <span class="pill">${typeLabel(e.type)}</span>
            ${e.attempts > 1 ? `<span class="pill">Best of ${e.attempts}</span>` : ""}
          </div>
          <div class="ec-count">${(e.competitors||[]).length} competitor${(e.competitors||[]).length===1?"":"s"} · ${escapeHtml(e.leaderName||"")}</div>
          <div class="ec-status ${e.status}">
            <span class="dot ${e.status}"></span>
            ${e.status === "completed" ? "Completed" : "In Progress"}
          </div>
        </div>
      `).join("");
      grid.querySelectorAll(".event-card").forEach(c => {
        c.addEventListener("click", () => openEventDetail(c.dataset.id));
      });
    }
  }
  function typeLabel(t) { return t === "timed" ? "Timed" : t === "distance" ? "Distance" : "Weight"; }

  /**
   * Builds the leader's Assignments view: events grouped by title, then by division,
   * with status pips per division and per individual event. The leader sees only
   * events whose staff list (any division/role) contains their name — plus any
   * events they personally created (legacy fallback).
   */
  function renderLeaderAssignments() {
    populateAgeFilter();
    const session = api.getSession();
    const myName = (session?.leaderName || "").trim().toLowerCase();
    const staff = state.school?.eventStaff || {};

    // Collect (eventTitle, division) pairs where this leader is staff
    const assignedKeys = new Set();    // "title|division"
    const titleToDivisions = new Map(); // title → Set(divisionName)
    Object.entries(staff).forEach(([title, byDiv]) => {
      Object.entries(byDiv || {}).forEach(([division, byRole]) => {
        const isMine = Object.values(byRole||{}).some(n => (n||"").trim().toLowerCase() === myName);
        if (!isMine) return;
        assignedKeys.add(`${title}|${division}`);
        if (!titleToDivisions.has(title)) titleToDivisions.set(title, new Set());
        titleToDivisions.get(title).add(division);
      });
    });

    // For each (title, division) key, find the actual event records that match
    const grid = $("#eventGrid");
    grid.classList.remove("event-grid"); // we'll use our own assignments class instead
    grid.classList.add("assignments");

    // Always also include events the leader personally created (legacy fallback)
    const legacyMine = state.events.filter(e => (e.leaderName||"").trim().toLowerCase() === myName);
    legacyMine.forEach(e => {
      const div = divisionForAge(e.age) || "—";
      const key = `${e.title}|${div}`;
      assignedKeys.add(key);
      if (!titleToDivisions.has(e.title)) titleToDivisions.set(e.title, new Set());
      titleToDivisions.get(e.title).add(div);
    });

    if (titleToDivisions.size === 0) {
      grid.innerHTML = `<div class="empty-assignments">
        <div class="empty-icon">🎽</div>
        <h2>No assignments yet</h2>
        <p>Your admin hasn't listed you as staff for any event.<br>
        You can still create your own event below.</p>
        <button class="btn primary" id="leaderCreateOwn" style="margin-top:14px">+ Start a new event</button>
      </div>`;
      $("#leaderCreateOwn")?.addEventListener("click", () => openNewEventModal());
      $("#eventsEmpty").hidden = true;
      return;
    }

    $("#eventsEmpty").hidden = true;

    // Sort titles alphabetically; divisions in the school's defined order
    const titles = [...titleToDivisions.keys()].sort();
    const divOrder = (state.school?.divisions||[]).map(d => d.name);
    const divSort = (a, b) => {
      const ai = divOrder.indexOf(a), bi = divOrder.indexOf(b);
      if (ai >= 0 && bi >= 0) return ai - bi;
      if (ai >= 0) return -1;
      if (bi >= 0) return 1;
      return a.localeCompare(b);
    };

    grid.innerHTML = titles.map(title => {
      const divs = [...titleToDivisions.get(title)].sort(divSort);
      return `
        <article class="assignment-event">
          <h3>${escapeHtml(title)}</h3>
          <div class="assignment-divisions">
            ${divs.map(divisionName => {
              const matching = state.events.filter(ev => {
                if ((ev.title||"").toLowerCase() !== title.toLowerCase()) return false;
                if (divisionName === "—") return divisionForAge(ev.age) == null;
                const range = (state.school?.divisions||[]).find(d => d.name === divisionName)?.ageRange;
                if (!range) return false;
                return ageInBand(ev.age, range);
              });
              const status = computeDivisionStatus(matching);
              return `
                <div class="assignment-division ${status}">
                  <div class="assignment-division-header">
                    <span class="status-pip ${status}">${status === "completed" ? "✓" : status === "in_progress" ? "⏱" : "·"}</span>
                    <span>${escapeHtml(divisionName)}</span>
                    <span class="muted small" style="margin-left:auto">${describeStatus(status, matching.length)}</span>
                  </div>
                  ${matching.length > 0 ? `
                    <div class="assignment-event-list">
                      ${matching.sort((a,b) => (a.age||"").localeCompare(b.age||"") || (a.gender||"").localeCompare(b.gender||""))
                        .map(ev => `
                          <div class="assignment-event-card ${ev.status}" data-id="${ev.id}">
                            <span class="age-gender">Age ${escapeHtml(ev.age)} ${escapeHtml(ev.gender)}</span>
                            <span class="ev-pip">${ev.status === "completed" ? "✓" : ev.status === "in_progress" ? "⏱" : "·"}</span>
                          </div>`).join("")}
                    </div>` : `
                    <div class="muted small" style="margin-top:4px">
                      No events created yet — <a href="#" data-create-for="${escapeHtml(title)}" data-division="${escapeHtml(divisionName)}">create one</a>
                    </div>`}
                </div>`;
            }).join("")}
          </div>
        </article>
      `;
    }).join("");

    grid.querySelectorAll(".assignment-event-card").forEach(card => {
      card.addEventListener("click", () => openEventDetail(card.dataset.id));
    });
    grid.querySelectorAll("[data-create-for]").forEach(a => {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        openNewEventModal({ title: a.dataset.createFor });
      });
    });
  }

  /** Returns 'completed' if all events under a division are completed, 'in_progress' if any started, else 'pending'. */
  function computeDivisionStatus(events) {
    if (events.length === 0) return "pending";
    if (events.every(e => e.status === "completed")) return "completed";
    if (events.some(e => e.status === "in_progress" || (e.status === "completed"))) return "in_progress";
    return "pending";
  }
  function describeStatus(status, n) {
    if (n === 0) return "not yet created";
    if (status === "completed") return `${n} done`;
    if (status === "in_progress") return `${n} in progress`;
    return `${n} pending`;
  }

  function populateAgeFilter() {
    const ages = state.school?.ageCategories || [];
    const cur = $("#filterAge").value;
    $("#filterAge").innerHTML = `<option value="">All</option>` + ages.map(a => `<option value="${escapeHtml(a)}">Age ${escapeHtml(a)}</option>`).join("");
    $("#filterAge").value = cur;
  }

  // ---------- New / Edit event modal ----------
  let editingEventId = null;

  function openNewEventModal(prefill={}) {
    editingEventId = null;
    $("#eventModalTitle").textContent = "New Event";
    populateModalDropdowns();
    $("#evTitle").value = prefill.title || "";
    $("#evCustomTitle").hidden = true;
    $("#evCustomTitle").value = "";
    $("#evAge").value = prefill.age || ($("#evAge").options[0]?.value || "");
    $("#evGender").value = prefill.gender || "Girls";
    $("#evType").value = prefill.type || "timed";
    $("#evAttempts").value = prefill.attempts || 1;
    $("#evUnit").value = prefill.unit || defaultUnitFor(prefill.type || "timed");
    $("#evScoreBy").value = prefill.scoreBy || "event";
    $("#evFormat").value = prefill.format || "individual";
    $("#evWind").value = prefill.wind != null ? prefill.wind : "";
    $("#evNotes").value = prefill.notes || "";
    $("#evCompetitors").value = "";
    $("#evCompetitors").parentElement.hidden = false;
    $("#eventModal").hidden = false;
  }

  function openEditEventModal(ev) {
    editingEventId = ev.id;
    $("#eventModalTitle").textContent = "Edit Event";
    populateModalDropdowns();
    if (![...$("#evTitle").options].some(o => o.value === ev.title)) {
      const opt = document.createElement("option");
      opt.value = ev.title; opt.textContent = ev.title;
      $("#evTitle").appendChild(opt);
    }
    $("#evTitle").value = ev.title;
    $("#evCustomTitle").hidden = true;
    $("#evAge").value = ev.age;
    $("#evGender").value = ev.gender;
    $("#evType").value = ev.type;
    $("#evAttempts").value = ev.attempts;
    $("#evUnit").value = ev.unit;
    $("#evScoreBy").value = ev.scoreBy || "event";
    $("#evFormat").value = ev.format || "individual";
    $("#evWind").value = ev.wind != null ? ev.wind : "";
    $("#evNotes").value = ev.notes || "";
    $("#evCompetitors").value = "";
    $("#evCompetitors").parentElement.hidden = true;
    $("#eventModal").hidden = false;
  }

  function populateModalDropdowns() {
    const lib = state.school?.eventLibrary || [];
    $("#evTitle").innerHTML = lib.map(t => `<option>${escapeHtml(t)}</option>`).join("");
    const ages = state.school?.ageCategories || [];
    $("#evAge").innerHTML = ages.map(a => `<option value="${escapeHtml(a)}">Age ${escapeHtml(a)}</option>`).join("");
  }

  function defaultUnitFor(type) {
    if (type === "timed") return "seconds";
    if (type === "distance") return "m";
    if (type === "weight") return "lbs";
    return "";
  }
  /** Returns admin-set defaults for a library event title, or a heuristic fallback. */
  function defaultsForTitle(title) {
    const overrides = (state.school?.eventDefaults || {})[title];
    if (overrides) return { type: overrides.type || "timed", attempts: overrides.attempts || 1, unit: overrides.unit || defaultUnitFor(overrides.type) };
    return inferEventType(title);
  }

  async function saveEventModal() {
    const titleSel = $("#evTitle").value;
    const customTitle = $("#evCustomTitle").value.trim();
    const title = (!$("#evCustomTitle").hidden && customTitle) ? customTitle : titleSel;
    if (!title) { showToast("Pick or enter a title"); return; }
    const data = {
      title,
      age: $("#evAge").value,
      gender: $("#evGender").value,
      type: $("#evType").value,
      attempts: Math.max(1, Math.min(10, parseInt($("#evAttempts").value, 10) || 1)),
      unit: $("#evUnit").value.trim(),
      scoreBy: $("#evScoreBy").value || "event",
      format: $("#evFormat").value || "individual",
      wind: $("#evWind").value === "" ? null : parseFloat($("#evWind").value),
      notes: $("#evNotes").value.trim()
    };
    $("#btnSaveModal").disabled = true;
    try {
      if (editingEventId) {
        const ev = state.events.find(e => e.id === editingEventId);
        // Resize attempts arrays if attempts count changed (server should also do this,
        // but we send the resized competitors so the server has authoritative data).
        const competitors = ev.competitors.map(c => {
          const arr = [...(c.attempts||[])];
          while (arr.length < data.attempts) arr.push(null);
          if (arr.length > data.attempts) arr.length = data.attempts;
          return { ...c, attempts: arr };
        });
        const resp = await api.updateEvent(editingEventId, { ...data, competitors });
        applyEntityUpdate(resp);
        $("#eventModal").hidden = true;
        openEventDetail(editingEventId);
        showToast("Event updated");
      } else {
        const session = api.getSession();
        const initial = $("#evCompetitors").value.split("\n").map(s => s.trim()).filter(Boolean);
        const competitors = initial.map(name => ({ id: uid(), name, attempts: Array(data.attempts).fill(null) }));
        const resp = await api.createEvent({
          ...data,
          leaderName: session?.leaderName || session?.email || "Admin",
          competitors
        });
        applyEntityUpdate(resp);
        $("#eventModal").hidden = true;
        if (resp?.event?.id) openEventDetail(resp.event.id);
        showToast("Event created");
      }
    } catch (e) {
      showToast("Save failed");
    } finally {
      $("#btnSaveModal").disabled = false;
    }
  }

  // ---------- Event detail ----------
  async function openEventDetail(id) {
    clearAllRowTimers();
    currentEventId = id;
    saveUiState({ eventId: id });
    VIEWS.forEach(v => $(`#view-${v}`).hidden = true);
    $("#view-event-detail").hidden = false;
    renderEventDetail();
    // refresh authoritative copy then re-render
    stopLivePolling();
    stopPoll = api.startPolling((s) => {
      state = { school: s.school || state.school, events: s.events || [], announceQueue: s.announceQueue || [] };
      // Sync local row-timer Map with server-side liveTimers — picks up other
      // helpers' Start/Stop actions and renders them on this client.
      const ev = state.events.find(e => e.id === currentEventId);
      if (ev) reconcileLiveTimers(ev);
      if (currentEventId && !$("#view-event-detail").hidden) renderEventDetail();
    }, POLL_MS_EVENT);
  }

  function renderEventDetail() {
    const ev = state.events.find(e => e.id === currentEventId);
    if (!ev) return;
    $("#eventDetailTitle").textContent = ev.title;
    const formatBadge = ev.format === "team"
      ? `<span class="pill" style="background:#fff7e0;color:#8a6d00">Team event · house-only</span>`
      : "";
    const windBadge = ev.wind != null && ev.wind !== ""
      ? `<span class="pill" style="background:${Number(ev.wind) > 2.0 ? "#fef0ee;color:#d92d20" : "#eef4ff;color:#2956ff"}">Wind ${Number(ev.wind).toFixed(1)} m/s${Number(ev.wind) > 2.0 ? " · wind-aided" : ""}</span>`
      : "";
    $("#eventDetailMeta").innerHTML = `
      <span>Age ${escapeHtml(ev.age)} · ${escapeHtml(ev.gender)} · ${typeLabel(ev.type)}${ev.unit?" ("+escapeHtml(ev.unit)+")":""} · Best of ${ev.attempts}</span>
      ${ev.notes ? `<span> · ${escapeHtml(ev.notes)}</span>` : ""}
      <span> · Led by ${escapeHtml(ev.leaderName||"")}</span>
      ${formatBadge ? ` · ${formatBadge}` : ""}
      ${windBadge ? ` · ${windBadge}` : ""}
    `;
    // Rules card — base + division-specific override merged
    const ruleText = rulesForEvent(ev);
    if (ruleText) {
      $("#eventRulesCard").hidden = false;
      $("#eventRulesText").textContent = ruleText;
    } else {
      $("#eventRulesCard").hidden = true;
    }
    // Add staff line under the meta if any leaders are recorded
    const staff = staffForEvent(ev);
    const staffBits = Object.entries(staff).filter(([,v]) => v).map(([role,name]) => `${escapeHtml(name)} (${escapeHtml(role)})`);
    if (staffBits.length > 0) {
      $("#eventDetailMeta").innerHTML += `<br><span class="muted small">Staff: ${staffBits.join(" · ")}</span>`;
    }

    $("#timerCard").hidden = ev.type !== "timed";
    // Gate the Start/Reset buttons against the school's restrictTimerStarts
    // setting so helpers see disabled buttons (with explanation) rather
    // than getting a confusing 403 after a tap.
    const canStart = canStartOrResetTimers(ev);
    const startBtn = $("#btnTimerStartAll");
    const resetBtn = $("#btnTimerResetAll");
    if (startBtn) {
      startBtn.disabled = !canStart;
      startBtn.title = canStart ? "Start every empty runner at once"
        : `Only ${escapeHtml(ev.leaderName || "the assigned leader")} (or admin) can start this event — Settings has the restriction on.`;
    }
    if (resetBtn) {
      resetBtn.disabled = !canStart;
      resetBtn.title = canStart ? "Stop every running stopwatch and clear results"
        : `Only ${escapeHtml(ev.leaderName || "the assigned leader")} (or admin) can reset this event.`;
    }
    const isCompleted = ev.status === "completed";
    $("#eventStatusDot").className = "dot " + ev.status;
    $("#eventStatusText").textContent = isCompleted ? "Completed" : "In Progress";
    $("#btnSubmitEvent").hidden = isCompleted;
    $("#btnReopenEvent").hidden = !isCompleted;

    // Admins can edit results even after submit (for score corrections).
    const readOnly = isCompleted && !isAdmin();
    const adminEditing = isCompleted && isAdmin();
    if (adminEditing) {
      $("#eventStatusText").textContent = "Completed (admin editing)";
      $("#eventStatusDot").className = "dot completed";
    }
    // Hide the add-competitor row when read-only; admins can still add even on completed events.
    const addRow = document.querySelector(".add-competitor-row");
    if (addRow) addRow.style.display = readOnly ? "none" : "";
    // Relabel "Add Competitor" → "Add Team" for team events
    const addBtn = $("#btnAddCompetitor");
    if (addBtn) addBtn.textContent = ev.format === "team" ? "+ Add Team" : "+ Add Competitor";
    const newNameInput = $("#newCompetitorName");
    if (newNameInput) newNameInput.placeholder = ev.format === "team" ? "Team name (e.g. Alpha Relay)" : "Competitor name";

    const placements = computePlacements(ev, state.school?.tieMethod || "average");
    const list = $("#competitorList");

    // Group competitors by heat (those without a heat go in an "Unassigned" bucket).
    const heatGroups = new Map();
    (ev.competitors||[]).forEach(c => {
      const key = (c.heat || "").trim() || "—";
      if (!heatGroups.has(key)) heatGroups.set(key, []);
      heatGroups.get(key).push(c);
    });
    const heatKeys = [...heatGroups.keys()].sort((a,b) => {
      if (a === "—") return 1;
      if (b === "—") return -1;
      const an = parseFloat(a), bn = parseFloat(b);
      if (!isNaN(an) && !isNaN(bn)) return an - bn;
      return a.localeCompare(b);
    });
    const showHeats = heatKeys.length > 1 || (heatKeys.length === 1 && heatKeys[0] !== "—");

    const renderRowHelper = (c) => {
      const p = placements.find(x => x.competitorId === c.id);
      const placeTag = p && p.place ? renderPlaceTag(p.place) : `<span class="place-tag">—</span>`;
      const best = bestOf(c.attempts, ev.type);
      const attemptInputs = (c.attempts||[]).map((v, i) => {
        const isTarget = (timerTarget?.competitorId === c.id && timerTarget?.attemptIdx === i);
        const isBest = (best != null && Number(v) === best && v != null && v !== "");
        const display = displayAttempt(v, ev.type);
        return `<input class="attempt-input ${isTarget?"target":""} ${isBest?"best":""}"
                 data-cid="${c.id}" data-aidx="${i}"
                 value="${display}"
                 placeholder="${ev.type === 'timed' ? 'mm:ss.ss' : ev.unit || '0'}"
                 ${readOnly?"disabled":""} />`;
      }).join("");
      const metaParts = [];
      if (c.bib) metaParts.push("#" + escapeHtml(c.bib));
      if (c.grade) metaParts.push("G" + escapeHtml(c.grade));
      if (c.actualAge) metaParts.push("age " + escapeHtml(c.actualAge));
      if (c.house) metaParts.push("🏠 " + escapeHtml(c.house));
      if (c.members && ev.format === "team") metaParts.push("👥 " + escapeHtml(c.members));
      if (c.dq) metaParts.push(`<span style="color:var(--danger);font-weight:700">DQ${c.dqReason ? " · " + escapeHtml(c.dqReason) : ""}</span>`);
      if (c.walkup) metaParts.push(`<span style="background:#fff7e0;color:#8a6d00;padding:1px 6px;border-radius:4px;font-weight:600">🆕 walk-up${c.walkupBy ? " · " + escapeHtml(c.walkupBy) : ""}</span>`);
      const meta = metaParts.length > 0
        ? `<span class="competitor-meta muted small">${metaParts.join(" · ")}</span>`
        : "";
      const isTimed = ev.type === "timed" && !readOnly;
      const running = rowTimers.has(c.id);
      // Stop is always allowed for any helper. Start is gated by the
      // school's restrictTimerStarts toggle — stays clickable in default
      // loose mode, disabled for non-leaders when the toggle is on.
      const startDisabled = !running && !canStartOrResetTimers(ev);
      const startTitle = running ? "Stop this runner"
        : (startDisabled
            ? `Only ${ev.leaderName || "the assigned leader"} can start this race (Settings restricts starts).`
            : "Start this runner");
      const inlineTimer = isTimed ? `
        <div class="row-timer" data-cid="${c.id}" ${running?"":"hidden"}><span class="row-timer-time">${running ? fmtTimer(performance.now()-rowTimers.get(c.id).startMs) : "00:00.00"}</span></div>
        <button class="row-timer-btn ${running?"running":""}" data-cid="${c.id}" data-row-timer="1" title="${escapeHtml(startTitle)}" ${startDisabled?"disabled":""}>${running?"⏹":"▶"}</button>
      ` : "";
      return `
        <div class="competitor-row" data-cid="${c.id}">
          <div class="competitor-name-block">
            <input class="name-input" value="${escapeHtml(c.name)}" data-cid="${c.id}" placeholder="Competitor name" ${readOnly?"disabled":""} />
            ${meta}
          </div>
          <div class="attempts">${attemptInputs}</div>
          <div class="row-actions">
            ${inlineTimer}
            ${placeTag}
            ${!readOnly ? `<button class="icon-btn" data-toggle-dq="${c.id}" title="${c.dq?"Reinstate":"Mark DQ"}" style="${c.dq?"color:var(--danger)":""}">${c.dq?"⊘":"DQ"}</button>` : ""}
            ${!readOnly ? `<button class="icon-btn" data-edit-meta="${c.id}" title="Edit bib / grade / age / heat / DQ reason">⚙︎</button>` : ""}
            ${!readOnly ? `<button class="icon-btn" data-clear-row="${c.id}" title="Clear all results for this competitor (keeps them in the event)">↺</button>` : ""}
            ${!readOnly ? `<button class="icon-btn" data-del="${c.id}" title="Remove competitor (deletes the person)">🗑</button>` : ""}
          </div>
        </div>`;
    };

    // Render — either flat or grouped by heat
    if (showHeats) {
      list.innerHTML = heatKeys.map(k => {
        const label = k === "—" ? "Unassigned" : `Heat ${k}`;
        return `
          <div class="heat-group" data-heat="${escapeHtml(k)}">
            <div class="heat-header">
              <span class="heat-title">${escapeHtml(label)}</span>
              <span class="muted small">${heatGroups.get(k).length} competitor${heatGroups.get(k).length===1?"":"s"}</span>
            </div>
            ${heatGroups.get(k).map(renderRowHelper).join("")}
          </div>
        `;
      }).join("");
    } else {
      list.innerHTML = (ev.competitors||[]).map(renderRowHelper).join("");
    }

    const sorted = (ev.competitors||[]).map(c => {
      const p = placements.find(x => x.competitorId === c.id);
      return { name: c.name, result: bestOf(c.attempts, ev.type), place: p?.place, points: p?.points };
    }).filter(x => x.result != null).sort((a,b) => compareResults(a.result, b.result, ev.type));
    $("#liveStandings").innerHTML = sorted.length === 0
      ? `<li class="muted">No results yet</li>`
      : sorted.map(s => `
          <li>
            ${s.place ? renderPlaceTag(s.place) : ""}
            <span class="name" data-student-name="${escapeHtml(s.name)}">${escapeHtml(s.name)}</span>
            <span class="res">${fmtResult(s.result, ev.type, ev.unit)}${s.points!=null?` · ${s.points}pt`:""}</span>
          </li>`).join("");

    list.querySelectorAll(".name-input").forEach(inp => {
      inp.addEventListener("change", async () => {
        try {
          const resp = await api.updateCompetitor(currentEventId, inp.dataset.cid, { name: inp.value.trim() });
          // patch local cache
          const ev2 = state.events.find(e => e.id === currentEventId);
          const c = ev2?.competitors.find(x => x.id === inp.dataset.cid);
          if (c && resp?.competitor) Object.assign(c, resp.competitor);
          renderEventDetail();
        } catch (e) { showToast("Save failed"); }
      });
    });
    list.querySelectorAll(".attempt-input").forEach(inp => {
      inp.addEventListener("focus", () => {
        timerTarget = { competitorId: inp.dataset.cid, attemptIdx: parseInt(inp.dataset.aidx,10) };
        list.querySelectorAll(".attempt-input").forEach(i2 => i2.classList.remove("target"));
        inp.classList.add("target");
      });
      inp.addEventListener("change", async () => {
        const ev2 = state.events.find(e => e.id === currentEventId);
        const idx = parseInt(inp.dataset.aidx, 10);
        const value = parseAttemptInput(inp.value, ev2.type);
        try {
          const resp = await api.setAttempt(currentEventId, inp.dataset.cid, idx, value);
          const c = ev2.competitors.find(x => x.id === inp.dataset.cid);
          if (c && resp?.competitor) Object.assign(c, resp.competitor);
          await checkForRecordBreak(ev2, c);
          await checkForPBBreak(ev2, c);
          renderEventDetail();
        } catch (e) { showToast("Save failed"); }
      });
    });
    list.querySelectorAll("[data-clear-row]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const ev2 = state.events.find(e => e.id === currentEventId);
        const c   = ev2?.competitors.find(x => x.id === btn.dataset.clearRow);
        const nm  = c?.name?.trim() || "this competitor";
        const filled = (c?.attempts || [])
          .map((v, i) => ({ v, i }))
          .filter(x => x.v != null && x.v !== "");
        if (filled.length === 0) { showToast("No results to clear"); return; }

        let toClear = [];
        if (filled.length === 1) {
          // Simple one-attempt case: just confirm and clear.
          const confirmed = await showFormModal({
            title: `Clear result for ${nm}?`,
            body: `This wipes ${nm}'s recorded ${typeLabel(ev2.type).toLowerCase()} but keeps them in the event so you can re-run them.`,
            fields: [],
            submitLabel: "Clear result",
            cancelLabel: "Keep it"
          });
          if (!confirmed) return;
          toClear = filled.map(x => x.i);
        } else {
          // Multi-attempt: let the user pick which attempts to wipe.
          toClear = await showAttemptClearModal(nm, filled, ev2);
          if (!toClear || toClear.length === 0) return;
        }

        // Snapshot the values we're about to clear so we can offer undo.
        const cidAtClear = c.id;
        const eventIdAtClear = currentEventId;
        const undoSnapshot = toClear.map(idx => ({ idx, value: c.attempts[idx] }));

        // Stop any running row timer first so it doesn't write back over us.
        if (rowTimers.has(c.id)) {
          const t = rowTimers.get(c.id);
          cancelAnimationFrame(t.raf);
          if (t.intervalId) clearInterval(t.intervalId);
          rowTimers.delete(c.id);
          persistRowTimers();
        }
        try {
          for (const idx of toClear) {
            const resp = await api.setAttempt(currentEventId, c.id, idx, null);
            if (resp?.competitor) Object.assign(c, resp.competitor);
          }
          renderEventDetail();
          showUndoToast(
            toClear.length === 1
              ? `Cleared attempt ${toClear[0]+1} for ${nm}`
              : `Cleared ${toClear.length} attempts for ${nm}`,
            async () => {
              for (const { idx, value } of undoSnapshot) {
                if (value != null && value !== "") {
                  const resp = await api.setAttempt(eventIdAtClear, cidAtClear, idx, value);
                  const evNow = state.events.find(e => e.id === eventIdAtClear);
                  const cNow = evNow?.competitors.find(x => x.id === cidAtClear);
                  if (cNow && resp?.competitor) Object.assign(cNow, resp.competitor);
                }
              }
              if (currentEventId === eventIdAtClear) renderEventDetail();
            }
          );
        } catch (e) { showToast("Clear failed"); }
      });
    });
    list.querySelectorAll("[data-del]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const ev2 = state.events.find(e => e.id === currentEventId);
        const c   = ev2?.competitors.find(x => x.id === btn.dataset.del);
        const nm  = c?.name?.trim() || "this competitor";
        const hasResult = (c?.attempts || []).some(v => v != null && v !== "");
        const confirmed = await showFormModal({
          title: `Remove ${nm}?`,
          body: hasResult
            ? `This will remove ${nm} and ALL their results from this event. To clear a score without removing the person, just delete the number in the result box. This cannot be undone.`
            : `This will remove ${nm} from this event. To clear a score without removing the person, just delete the number in the result box.`,
          fields: [],
          submitLabel: "Remove competitor",
          cancelLabel: "Keep them"
        });
        if (!confirmed) return;
        try {
          await api.deleteCompetitor(currentEventId, btn.dataset.del);
          if (ev2) ev2.competitors = ev2.competitors.filter(x => x.id !== btn.dataset.del);
          renderEventDetail();
        } catch (e) { showToast("Delete failed"); }
      });
    });
    list.querySelectorAll("[data-row-timer]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const cid = btn.dataset.cid;
        const ev2 = state.events.find(e => e.id === currentEventId);
        if (!ev2) return;
        const isRunningServer = !!(ev2.liveTimers && ev2.liveTimers[cid]);
        const isRunningLocal  = rowTimers.has(cid);
        if (isRunningServer || isRunningLocal) {
          // Stop the server-side timer — server records elapsed and writes
          // into the next empty attempt slot, then broadcasts via state poll.
          await sendStopRowTimer(cid);
        } else {
          // Optimistic local start so the user sees the clock immediately,
          // then send to server. Server is source of truth — its response
          // (or the next poll) will reconcile any drift.
          await sendStartRowTimer(cid);
        }
      });
    });
    list.querySelectorAll("[data-toggle-dq]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const ev2 = state.events.find(e => e.id === currentEventId);
        const c = ev2?.competitors.find(x => x.id === btn.dataset.toggleDq);
        if (!c) return;
        let patch;
        if (c.dq) {
          const out = await showFormModal({
            title: `Reinstate ${c.name}?`,
            body: "They were disqualified. Reinstating means their result will count toward placement again.",
            fields: [],
            submitLabel: "Reinstate",
            cancelLabel: "Keep DQ"
          });
          if (!out) return;
          patch = { dq: false, dqReason: "" };
        } else {
          const out = await showFormModal({
            title: `Disqualify ${c.name}?`,
            body: "DQ removes them from placement and points. Standard reasons: false start, lane infringement, baton drop, equipment foul.",
            fields: [
              { name: "reason", label: "Reason", value: c.dqReason || "false start", placeholder: "false start" }
            ],
            submitLabel: "Disqualify",
            cancelLabel: "Cancel"
          });
          if (!out) return;
          patch = { dq: true, dqReason: out.reason };
        }
        try {
          const resp = await api.updateCompetitor(currentEventId, c.id, patch);
          if (resp?.competitor) Object.assign(c, resp.competitor);
          renderEventDetail();
        } catch (e) { showToast("Save failed"); }
      });
    });
    list.querySelectorAll("[data-edit-meta]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const ev2 = state.events.find(e => e.id === currentEventId);
        const c = ev2?.competitors.find(x => x.id === btn.dataset.editMeta);
        if (!c) return;
        const out = await showFormModal({
          title: `Edit details — ${c.name}`,
          submitLabel: "Save details",
          fields: [
            { name: "bib",       label: "Bib / race number", value: c.bib       || "", placeholder: "42",   help: "Leave blank to clear." },
            { name: "grade",     label: "Grade",             value: c.grade     || "", placeholder: "3" },
            { name: "actualAge", label: "Actual age (override)", value: c.actualAge || "", placeholder: ev2.age, help: `Defaults to event's age "${ev2.age}". Set if running in a different age group than their actual age.` },
            { name: "heat",      label: "Heat",              value: c.heat      || "", placeholder: "1, A, Fast", help: "Groups competitors visually within the event." }
          ]
        });
        if (!out) return;
        try {
          const resp = await api.updateCompetitor(currentEventId, c.id, { bib: out.bib, grade: out.grade, actualAge: out.actualAge, heat: out.heat });
          if (resp?.competitor) Object.assign(c, resp.competitor);
          renderEventDetail();
        } catch (e) { showToast("Save failed"); }
      });
    });
  }

  function renderPlaceTag(place) {
    const cls = ["", "gold", "silver", "bronze", "fourth"][Math.min(4, Math.floor(place))] || "";
    const pretty = Number.isInteger(place) ? `${ordinal(place)}` : `T-${ordinal(Math.floor(place))}`;
    return `<span class="place-tag ${cls}">${pretty}</span>`;
  }
  function ordinal(n) {
    const s = ["th","st","nd","rd"], v = n % 100;
    return n + (s[(v-20)%10] || s[v] || s[0]);
  }
  function displayAttempt(v, type) {
    if (v == null || v === "") return "";
    if (type === "timed") {
      const total = Number(v);
      const mins = Math.floor(total/60);
      const rem = total - mins*60;
      const secStr = rem.toFixed(2).padStart(5, "0");
      return `${String(mins).padStart(2,"0")}:${secStr}`;
    }
    return String(v);
  }
  function parseAttemptInput(text, type) {
    text = (text||"").trim();
    if (!text) return null;
    if (type === "timed") {
      let total = 0;
      if (text.includes(":")) {
        const [m, s] = text.split(":");
        total = (parseInt(m,10)||0)*60 + parseFloat(s||"0");
      } else {
        total = parseFloat(text);
      }
      if (isNaN(total)) return null;
      return Math.round(total*100)/100;
    }
    const n = parseFloat(text);
    return isNaN(n) ? null : n;
  }

  // ---------- Multi-row timers (heat stopwatch) ----------
  /** competitorId → { startMs, raf } */
  const rowTimers = new Map();

  function persistRowTimers() {
    const ev = state.events.find(e => e.id === currentEventId);
    if (!ev) return;
    const epochOffset = Date.now() - performance.now();
    const snapshot = {};
    rowTimers.forEach((t, cid) => { snapshot[cid] = t.startMs + epochOffset; }); // store as Date.now() ms
    saveUiState({ runningTimers: { eventId: currentEventId, starts: snapshot } });
  }

  /**
   * Reconcile the local rowTimers Map against an event's server-side
   * liveTimers map. This is what makes multi-leader stopwatches feel live:
   * if Helper A taps Start, Helper B's next poll sees the row in
   * ev.liveTimers and starts ticking it on B's screen too.
   *
   * Translation: server-clock startedAt → local performance.now() basis,
   * via the cached clock skew.
   */
  function reconcileLiveTimers(ev) {
    if (!ev) return;
    const serverLive = ev.liveTimers || {};
    // 1. Stop any local timers no longer running on the server.
    for (const cid of [...rowTimers.keys()]) {
      if (!serverLive[cid]) {
        const t = rowTimers.get(cid);
        if (t) {
          cancelAnimationFrame(t.raf);
          if (t.intervalId) clearInterval(t.intervalId);
        }
        rowTimers.delete(cid);
      }
    }
    // 2. Start any new server-side timers that aren't yet running locally.
    const skew = (api.getClockSkew && api.getClockSkew()) || 0;
    const epochOffset = Date.now() - performance.now();
    for (const [cid, info] of Object.entries(serverLive)) {
      if (rowTimers.has(cid)) continue;
      const startedAtServer = Number(info?.startedAt) || (Date.now() + skew);
      // Convert server-clock ms → wall-clock ms on this device → performance.now().
      const startedAtWall = startedAtServer - skew;
      const startedAtPerf = startedAtWall - epochOffset;
      startRowTimer(cid, startedAtPerf, /*alreadyOnServer=*/true);
    }
    if (rowTimers.size === 0) stopHeatClock();
    else if (!timerHandle) startHeatClock();
  }

  function startRowTimer(competitorId, startMsOverride, alreadyOnServer) {
    if (rowTimers.has(competitorId)) return;
    const startMs = (typeof startMsOverride === "number") ? startMsOverride : performance.now();
    // Paint the current state synchronously so the user sees feedback on the
    // very same frame as their click — don't wait for the first rAF (which on
    // some browsers/tabs can be throttled to ~250ms).
    const paint = () => {
      const t = rowTimers.get(competitorId);
      if (!t) return false;
      const display = document.querySelector(`.row-timer[data-cid="${competitorId}"] .row-timer-time`);
      if (display) display.textContent = fmtTimer(performance.now() - startMs);
      const tDiv = document.querySelector(`.row-timer[data-cid="${competitorId}"]`);
      if (tDiv && tDiv.hidden) tDiv.hidden = false;
      const btn = document.querySelector(`.row-timer-btn[data-cid="${competitorId}"]`);
      if (btn && !btn.classList.contains("running")) { btn.classList.add("running"); btn.textContent = "⏹"; }
      return true;
    };
    const tick = () => {
      if (!paint()) return;
      const t = rowTimers.get(competitorId);
      if (t) t.raf = requestAnimationFrame(tick);
    };
    // Belt-and-suspenders: a 100ms setInterval keeps painting even if rAF is
    // throttled (e.g. background tab) — display jitters by at most 100ms,
    // which is still far smoother than not appearing at all.
    const intervalId = setInterval(paint, 100);
    rowTimers.set(competitorId, { startMs, raf: requestAnimationFrame(tick), intervalId });
    // Synchronous first paint — no waiting for the first animation frame.
    paint();
    // Mirror the heat clock at the top: first row timer starts the big clock.
    if (typeof startHeatClock === "function") startHeatClock();
    persistRowTimers();
  }

  async function stopRowTimer(competitorId) {
    const t = rowTimers.get(competitorId);
    if (!t) return;
    cancelAnimationFrame(t.raf);
    if (t.intervalId) clearInterval(t.intervalId);
    rowTimers.delete(competitorId);
    // If this was the last running row, freeze the heat clock at its current
    // value (so the leader sees the final heat duration on the big display).
    if (rowTimers.size === 0) stopHeatClock();
    persistRowTimers();
    const elapsedMs = performance.now() - t.startMs;
    const seconds = Math.round(elapsedMs / 10) / 100;
    // Find next empty attempt slot for this competitor and write the time
    const ev = state.events.find(e => e.id === currentEventId);
    const c = ev?.competitors.find(x => x.id === competitorId);
    if (!ev || !c) return;
    const slot = (c.attempts||[]).findIndex(v => v == null || v === "");
    const idx = slot >= 0 ? slot : (c.attempts||[]).length - 1;
    if (idx < 0) return;
    try {
      const resp = await api.setAttempt(currentEventId, competitorId, idx, seconds);
      if (resp?.competitor) Object.assign(c, resp.competitor);
      await checkForRecordBreak(ev, c);
      await checkForPBBreak(ev, c);
      renderEventDetail();
      drainCelebrationsAfterTimer();
    } catch (e) { showToast("Save failed"); }
  }

  /**
   * Tell the server to start a row's stopwatch. The server pins the start
   * moment with the timestamp we capture LOCALLY before the request — that
   * way network latency on the request doesn't change the recorded time.
   * On success we eagerly add the timer to our local rowTimers Map so the
   * clock paints on the next animation frame; the next poll will confirm.
   */
  async function sendStartRowTimer(competitorId) {
    // Optimistic: paint immediately on this client. The server's startedAt
    // will match because both are computed as Date.now() + skew.
    const skew = (api.getClockSkew && api.getClockSkew()) || 0;
    const epochOffset = Date.now() - performance.now();
    const startMsLocal = performance.now();   // matches Date.now() + skew via epochOffset
    startRowTimer(competitorId, startMsLocal, /*alreadyOnServer=*/true);
    try {
      const resp = await api.timerStart(currentEventId, competitorId,
                                        api.getSession()?.leaderName || api.getSession()?.email || "");
      if (resp?.event) {
        const idx = state.events.findIndex(e => e.id === resp.event.id);
        if (idx >= 0) state.events[idx] = resp.event;
        reconcileLiveTimers(resp.event);
      }
    } catch (e) {
      // Roll back the optimistic timer if the server rejected.
      if (rowTimers.has(competitorId)) {
        const t = rowTimers.get(competitorId);
        cancelAnimationFrame(t.raf);
        if (t.intervalId) clearInterval(t.intervalId);
        rowTimers.delete(competitorId);
      }
      showToast("Couldn't start timer — check connection");
    }
  }

  /**
   * Tell the server to stop a row's stopwatch. Server computes elapsed
   * from its stored startedAt and the timestamp we send (captured locally
   * before the request), writes into the next empty attempt slot, and
   * returns the updated event. We patch state and re-render.
   */
  async function sendStopRowTimer(competitorId) {
    // Stop the local rAF immediately (snappy UX) — the recorded time
    // comes from the server's response.
    const t = rowTimers.get(competitorId);
    if (t) {
      cancelAnimationFrame(t.raf);
      if (t.intervalId) clearInterval(t.intervalId);
      rowTimers.delete(competitorId);
    }
    if (rowTimers.size === 0) stopHeatClock();
    persistRowTimers();
    try {
      const resp = await api.timerStop(currentEventId, competitorId);
      if (resp?.event) {
        const idx = state.events.findIndex(e => e.id === resp.event.id);
        if (idx >= 0) state.events[idx] = resp.event;
        const ev = state.events[idx >= 0 ? idx : 0];
        const c = ev?.competitors.find(x => x.id === competitorId);
        if (c && resp.competitor) Object.assign(c, resp.competitor);
        reconcileLiveTimers(ev);
        await checkForRecordBreak(ev, c);
        await checkForPBBreak(ev, c);
        renderEventDetail();
        drainCelebrationsAfterTimer();
      }
    } catch (e) {
      showToast("Couldn't stop timer — check connection");
    }
  }

  /**
   * Mass-start every competitor with an empty attempt slot — server pins
   * one shared startedAt for all of them, so every helper's screen sees the
   * exact same race start. The starter's pistol effect is then just one
   * helper tapping "Start All".
   */
  async function startAllRowTimers() {
    const ev = state.events.find(e => e.id === currentEventId);
    if (!ev) return;
    try {
      const resp = await api.timerStartAll(currentEventId,
        api.getSession()?.leaderName || api.getSession()?.email || "");
      if (resp?.event) {
        const idx = state.events.findIndex(e => e.id === resp.event.id);
        if (idx >= 0) state.events[idx] = resp.event;
        reconcileLiveTimers(resp.event);
        renderEventDetail();
      }
    } catch (e) { showToast("Couldn't start race — check connection"); }
  }
  /** Clear every running stopwatch on the server WITHOUT recording. */
  async function stopAllRowTimers() {
    try {
      const resp = await api.timerResetAll(currentEventId);
      if (resp?.event) {
        const idx = state.events.findIndex(e => e.id === resp.event.id);
        if (idx >= 0) state.events[idx] = resp.event;
        reconcileLiveTimers(resp.event);
        renderEventDetail();
      }
    } catch (e) { showToast("Couldn't cancel timers — check connection"); }
  }
  function clearAllRowTimers() {
    rowTimers.forEach(t => {
      cancelAnimationFrame(t.raf);
      if (t.intervalId) clearInterval(t.intervalId);
    });
    rowTimers.clear();
  }
  /** True if any row timer is active. Used to gate celebrations. */
  function anyTimerRunning() { return timerHandle != null || rowTimers.size > 0; }

  /**
   * Reset every result in the current event — useful for a false start or
   * before re-running the same heat. Stops any in-flight stopwatches WITHOUT
   * recording (so no bogus 0.42s times get logged), then nulls every attempt
   * for every competitor in the event.
   */
  async function resetAllInEvent() {
    const ev = state.events.find(e => e.id === currentEventId);
    if (!ev) return;
    const filledCount = (ev.competitors || []).reduce((acc, c) =>
      acc + (c.attempts || []).filter(v => v != null && v !== "").length, 0);
    const runningCount = rowTimers.size;
    if (filledCount === 0 && runningCount === 0) {
      showToast("Nothing to reset");
      return;
    }
    const parts = [];
    if (runningCount) parts.push(`${runningCount} running stopwatch${runningCount===1?"":"es"}`);
    if (filledCount) parts.push(`${filledCount} recorded result${filledCount===1?"":"s"}`);
    const confirmed = await showFormModal({
      title: `Reset every result in this event?`,
      body: `This stops ${parts.join(" and ")} for ${escapeHtml(ev.title)}. Stopwatches will be cancelled WITHOUT recording, and every recorded time / distance / weight will be cleared. Competitors stay in the event. This cannot be undone.`,
      fields: [],
      submitLabel: "Reset event",
      cancelLabel: "Keep results"
    });
    if (!confirmed) return;
    // 1. Snapshot every result so we can offer a 15-second undo window.
    //    Stored as { [competitorId]: [attempts copy] } — independent of the
    //    live state objects (which we're about to mutate).
    const snapshot = {};
    for (const c of ev.competitors || []) {
      snapshot[c.id] = (c.attempts || []).slice();
    }
    // 2. Cancel every running stopwatch silently (no record).
    rowTimers.forEach(t => {
      cancelAnimationFrame(t.raf);
      if (t.intervalId) clearInterval(t.intervalId);
    });
    rowTimers.clear();
    // Reset the big heat clock display too — fresh state for the next heat.
    resetTimer();
    persistRowTimers();
    // Also tell the server to clear any running timers for OTHER helpers,
    // so their screens drop to 0 too.
    try { await api.timerResetAll(currentEventId); } catch (e) { /* offline ok */ }
    // 3. Null out every attempt slot via the same setAttempt path.
    try {
      for (const c of ev.competitors || []) {
        for (let i = 0; i < (c.attempts || []).length; i++) {
          if (c.attempts[i] != null && c.attempts[i] !== "") {
            const resp = await api.setAttempt(currentEventId, c.id, i, null);
            if (resp?.competitor) Object.assign(c, resp.competitor);
          }
        }
      }
      renderEventDetail();
      // 4. Offer an Undo for 15 seconds — restore every snapshotted value.
      const eventIdAtReset = currentEventId;
      showUndoToast(
        `Event reset · ${ev.competitors.length} competitor${ev.competitors.length===1?"":"s"} cleared`,
        async () => {
          for (const [cid, attempts] of Object.entries(snapshot)) {
            for (let i = 0; i < attempts.length; i++) {
              if (attempts[i] != null && attempts[i] !== "") {
                const resp = await api.setAttempt(eventIdAtReset, cid, i, attempts[i]);
                const evNow = state.events.find(e => e.id === eventIdAtReset);
                const cNow = evNow?.competitors.find(x => x.id === cid);
                if (cNow && resp?.competitor) Object.assign(cNow, resp.competitor);
              }
            }
          }
          if (currentEventId === eventIdAtReset) renderEventDetail();
        }
      );
    } catch (e) { showToast("Reset failed"); }
  }

  // ---------- Timer ----------
  /**
   * Start the big "Heat Stopwatch" display purely as a visual heat clock —
   * no target cell, no recording. Idempotent. Used by the row-timer code
   * so the big clock at the top of the timer card mirrors the heat.
   */
  function startHeatClock() {
    if (timerHandle) return;
    timerStart = performance.now();
    timerHandle = requestAnimationFrame(tickTimer);
  }
  /**
   * Stop the big heat clock display without recording anything to a cell.
   * (Different from stopTimer, which writes elapsed time to timerTarget.)
   */
  function stopHeatClock() {
    if (!timerHandle) return;
    cancelAnimationFrame(timerHandle);
    timerHandle = null;
  }
  function startTimer() {
    if (timerHandle) return;
    timerStart = performance.now();
    timerHandle = requestAnimationFrame(tickTimer);
    $("#btnTimerStart").disabled = true;
    $("#btnTimerStop").disabled = false;
  }
  function tickTimer() {
    const ms = performance.now() - timerStart;
    $("#timerDisplay").textContent = fmtTimer(ms);
    timerHandle = requestAnimationFrame(tickTimer);
  }
  async function stopTimer() {
    if (!timerHandle) return;
    cancelAnimationFrame(timerHandle);
    timerHandle = null;
    const elapsedMs = performance.now() - timerStart;
    const seconds = Math.round(elapsedMs/10)/100;
    $("#timerDisplay").textContent = fmtTimer(elapsedMs);
    $("#btnTimerStart").disabled = false;
    $("#btnTimerStop").disabled = true;
    if (timerTarget) {
      try {
        const resp = await api.setAttempt(currentEventId, timerTarget.competitorId, timerTarget.attemptIdx, seconds);
        const ev = state.events.find(e => e.id === currentEventId);
        const c = ev?.competitors.find(x => x.id === timerTarget.competitorId);
        if (c && resp?.competitor) Object.assign(c, resp.competitor);
        await checkForRecordBreak(ev, c);
        await checkForPBBreak(ev, c);
        advanceTimerTarget();
        renderEventDetail();
        // Now that timer's done for this run, drain any queued celebrations.
        drainCelebrationsAfterTimer();
      } catch (e) { showToast("Save failed"); }
    } else {
      showToast("Tap a result cell first, then Start.");
    }
  }
  function resetTimer() {
    if (timerHandle) cancelAnimationFrame(timerHandle);
    timerHandle = null;
    $("#timerDisplay").textContent = "00:00.00";
    $("#btnTimerStart").disabled = false;
    $("#btnTimerStop").disabled = true;
    drainCelebrationsAfterTimer();
  }
  function advanceTimerTarget() {
    const ev = state.events.find(e => e.id === currentEventId);
    if (!ev || !timerTarget) return;
    const cIdx = ev.competitors.findIndex(c => c.id === timerTarget.competitorId);
    for (let i = cIdx+1; i < ev.competitors.length; i++) {
      if (ev.competitors[i].attempts[timerTarget.attemptIdx] == null) {
        timerTarget = { competitorId: ev.competitors[i].id, attemptIdx: timerTarget.attemptIdx };
        return;
      }
    }
    if (timerTarget.attemptIdx + 1 < ev.attempts) {
      const nextIdx = timerTarget.attemptIdx + 1;
      const nextC = ev.competitors.find(c => c.attempts[nextIdx] == null);
      if (nextC) { timerTarget = { competitorId: nextC.id, attemptIdx: nextIdx }; return; }
    }
    timerTarget = null;
  }

  // ---------- Add competitor / submit / reopen / delete ----------
  async function addCompetitor() {
    const name = $("#newCompetitorName").value.trim();
    if (!name) { $("#newCompetitorName").focus(); return; }
    const ev = state.events.find(e => e.id === currentEventId);
    const session = api.getSession();
    // Tag the addition so admin can reconcile walk-ups later. Even admins
    // adding directly here are flagged "walkup" — admin can flick the flag
    // off via the Walk-ups panel.
    const walkupPatch = {
      walkup: true,
      walkupBy: session?.leaderName || session?.email || "",
      walkupAt: Date.now()
    };
    if (ev?.format === "team") {
      // Branded form modal for team metadata (members + house)
      const houseHelp = (state.school?.houses||[]).length > 0
        ? `Available houses: ${(state.school.houses||[]).join(", ")}`
        : "Add houses in Settings if you'd like to track points by house.";
      const out = await showFormModal({
        title: `Add team — ${name}`,
        body: "Optional details for this team. Members are stored on the team record; semicolon-separated names work best (commas can clash with the CSV importer).",
        fields: [
          { name: "members", label: "Members",
            value: "", placeholder: "Maya Patel; Liam Cole; Ava Chen",
            help: "Optional — semicolon-separated list of runners on this team." },
          { name: "house",   label: "House",
            value: "", placeholder: (state.school?.houses?.[0] || "Alpha"),
            help: houseHelp }
        ],
        submitLabel: "Add Team",
        cancelLabel: "Cancel"
      });
      if (!out) return;
      const members = out.members || "";
      const house   = out.house   || "";
      try {
        const resp = await api.addCompetitor(currentEventId, name);
        const created = resp?.competitor;
        if (created) {
          const patch = Object.assign({ members: members.trim(), house: (house||"").trim() }, walkupPatch);
          const u = await api.updateCompetitor(currentEventId, created.id, patch);
          if (u?.competitor) Object.assign(created, u.competitor);
          ev.competitors.push(created);
        }
        $("#newCompetitorName").value = "";
        renderEventDetail();
        showToast(`Added ${name} (walk-up)`);
      } catch (e) { showToast("Couldn't add team"); }
      return;
    }
    try {
      const resp = await api.addCompetitor(currentEventId, name);
      const created = resp?.competitor;
      const evLive = state.events.find(e => e.id === currentEventId);
      if (evLive && created) {
        // Tag as walk-up so admin can reconcile later.
        try {
          const u = await api.updateCompetitor(currentEventId, created.id, walkupPatch);
          if (u?.competitor) Object.assign(created, u.competitor);
        } catch (e) {}
        evLive.competitors.push(created);
      }
      $("#newCompetitorName").value = "";
      renderEventDetail();
      showToast(`Added ${name} — admin will see them on the Walk-ups list`);
    } catch (e) { showToast("Couldn't add competitor"); }
  }

  async function submitEvent() {
    const ev = state.events.find(e => e.id === currentEventId);
    if (!ev) return;
    if (!ev.competitors || ev.competitors.length === 0) { showToast("Add at least one competitor"); return; }
    try {
      const resp = await api.submitEvent(currentEventId);
      applyEntityUpdate(resp);
      if (!state.announceQueue.includes(currentEventId)) state.announceQueue.push(currentEventId);
      renderEventDetail();
      updateAnnounceBadge();
      updateCompletionBar();
      showToast("Event submitted ✓");
    } catch (e) { showToast("Submit failed"); }
  }
  async function reopenEvent() {
    try {
      const resp = await api.reopenEvent(currentEventId);
      applyEntityUpdate(resp);
      state.announceQueue = state.announceQueue.filter(id => id !== currentEventId);
      renderEventDetail();
      updateAnnounceBadge();
      updateCompletionBar();
    } catch (e) { showToast("Reopen failed"); }
  }
  async function deleteEvent() {
    const ev = state.events.find(e => e.id === currentEventId);
    if (!ev) return;
    if (!confirm(`Delete event "${ev.title}"? This cannot be undone.`)) return;
    try {
      await api.deleteEvent(currentEventId);
      state.events = state.events.filter(e => e.id !== currentEventId);
      state.announceQueue = state.announceQueue.filter(id => id !== currentEventId);
      setView("events");
      showToast("Event deleted");
    } catch (e) { showToast("Delete failed"); }
  }

  // ---------- Scoring ----------
  /**
   * Computes placements + points for an event.
   * - When ev.scoreBy === "ageBand", competitors are first partitioned by their
   *   actualAge's age band (or the event's age band if actualAge is missing),
   *   and 1st/2nd/3rd are awarded WITHIN each band. So a grade-grouped event
   *   can have a separate "1st place" for each age in the heat.
   * - Otherwise (default), placements are computed across the whole event.
   */
  function computePlacements(ev, tieMode = "average") {
    const groupBy = (ev.scoreBy === "ageBand")
      ? (c) => bandForAge(c.actualAge || ev.age) || "_"
      : () => "_";
    const buckets = new Map();
    (ev.competitors||[]).forEach(c => {
      const key = groupBy(c);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(c);
    });
    const placements = [];
    for (const [, comps] of buckets) {
      const rows = comps.map(c => ({ competitorId: c.id, best: bestOf(c.attempts, ev.type) }));
      const withResults = rows.filter(r => r.best != null);
      const noResults = rows.filter(r => r.best == null);
      withResults.sort((a,b) => compareResults(a.best, b.best, ev.type));
      const tiedGroups = [];
      for (const r of withResults) {
        const last = tiedGroups[tiedGroups.length-1];
        if (last && last[0].best === r.best) last.push(r); else tiedGroups.push([r]);
      }
      let curPlace = 1;
      for (const group of tiedGroups) {
        const span = group.length;
        const used = []; for (let i=0;i<span;i++) used.push(curPlace+i);
        group.forEach(r => {
          let assignedPlace, points;
          if (tieMode === "higher") { assignedPlace = curPlace; points = pointsForPlace(curPlace); }
          else { assignedPlace = curPlace; const total = used.reduce((s,p)=>s+pointsForPlace(p),0); points = Math.round((total/used.length)*100)/100; }
          placements.push({ competitorId: r.competitorId, place: assignedPlace, tied: span > 1, points });
        });
        curPlace += span;
      }
      if (ev.status === "completed") noResults.forEach(r => placements.push({ competitorId: r.competitorId, place: null, tied: false, points: COMPLETION_POINTS }));
      else noResults.forEach(r => placements.push({ competitorId: r.competitorId, place: null, tied: false, points: 0 }));
    }
    return placements;
  }
  function pointsForPlace(p) { return PLACE_POINTS[p] ?? 0; }

  // ---------- Admin ----------
  function renderAdmin() {
    // Stamp the "live · updated HH:MM:SS" indicator so the admin can see at
    // a glance that the page is current — eliminates the worst end-of-day
    // worry ("did we actually record anything?"). Updates on every poll.
    const liveTime = $("#liveUpdatedTime");
    if (liveTime) {
      const d = new Date();
      const hh = String(d.getHours()).padStart(2,"0");
      const mm = String(d.getMinutes()).padStart(2,"0");
      const ss = String(d.getSeconds()).padStart(2,"0");
      liveTime.textContent = `${hh}:${mm}:${ss}`;
    }
    const events = state.events;
    const completed = events.filter(e => e.status === "completed");
    const inProgress = events.filter(e => e.status === "in_progress");
    const competitors = new Set();
    events.forEach(e => (e.competitors||[]).forEach(c => competitors.add(`${e.age}|${e.gender}|${(c.name||"").toLowerCase()}`)));
    $("#kpiEvents").textContent = events.length;
    $("#kpiCompleted").textContent = completed.length;
    $("#kpiInProgress").textContent = inProgress.length;
    $("#kpiCompetitors").textContent = competitors.size;

    renderWalkupsBlock(events);
    renderOverallStandings(events);
    renderHouseStandings(events);
    renderRecordsBlock();

    const totals = computeTotalsByCategory(events, state.school?.tieMethod || "average");
    const categories = Object.keys(totals).sort();
    $("#pointsTables").innerHTML = categories.length === 0
      ? `<div class="muted">Submit events to see points totals.</div>`
      : categories.map(cat => {
          const rows = totals[cat].slice(0, 10);
          return `
          <div class="points-table">
            <h3>${escapeHtml(cat)}</h3>
            <table>
              <thead><tr><th>#</th><th>Competitor</th><th class="pts">Points</th></tr></thead>
              <tbody>${rows.map((r, i) => `
                <tr><td class="rank-num">${i+1}</td><td>${escapeHtml(r.name)}</td><td class="pts">${r.points}</td></tr>`).join("")}
              </tbody>
            </table>
          </div>`;
        }).join("");

    const groups = {};
    events.forEach(e => { const cat = `Age ${e.age} ${e.gender}`; (groups[cat] = groups[cat] || []).push(e); });
    const groupKeys = Object.keys(groups).sort();
    $("#categoryGroups").innerHTML = groupKeys.length === 0
      ? `<div class="muted">No events yet.</div>`
      : groupKeys.map(k => `
          <div class="category-group">
            <h3>${escapeHtml(k)} <span class="muted small">(${groups[k].length})</span></h3>
            <div class="category-events">
              ${groups[k].map(e => `
                <div class="cat-event" data-id="${e.id}">
                  <span>${escapeHtml(e.title)}</span>
                  <span class="status-pip ${e.status}">${e.status === "completed" ? "Done" : "Live"}</span>
                </div>`).join("")}
            </div>
          </div>`).join("");
    $$("#categoryGroups .cat-event").forEach(el => el.addEventListener("click", () => openEventDetail(el.dataset.id)));
  }

  /**
   * Builds a name → {gender, age, points} map summed across every event.
   * Names are normalized lowercased to dedupe; we keep the original casing
   * from the first occurrence as the display name.
   */
  function computeAllPersonTotals(events, tieMethod) {
    const acc = new Map(); // key = "gender|name_lower" → entry
    events.forEach(ev => {
      // Team / relay events feed only the house standings, not individual totals.
      if (ev.format === "team") return;
      const placements = computePlacements(ev, tieMethod);
      placements.forEach(p => {
        const c = (ev.competitors||[]).find(c => c.id === p.competitorId);
        if (!c || !c.name) return;
        const key = `${ev.gender}|${c.name.trim().toLowerCase()}`;
        let entry = acc.get(key);
        if (!entry) {
          entry = { name: c.name.trim(), gender: ev.gender, ages: new Set(), grades: new Set(), points: 0 };
          acc.set(key, entry);
        }
        entry.points += (p.points || 0);
        // For age-band rollup, prefer the competitor's actualAge over the event's age,
        // so a kid running with an older group still rolls up to their own band.
        const rolloverAge = c.actualAge || String(ev.age);
        entry.ages.add(String(rolloverAge));
        if (c.grade) entry.grades.add(String(c.grade));
      });
    });
    return [...acc.values()].map(e => ({ ...e, points: Math.round(e.points * 100) / 100 }))
      .sort((a,b) => b.points - a.points);
  }

  function renderOverallStandings(events) {
    const tie = state.school?.tieMethod || "average";
    const all = computeAllPersonTotals(events, tie);
    const ageBands = state.school?.ageBands || [];

    function podium(rows, limit = 3) {
      if (rows.length === 0) return `<div class="muted small">—</div>`;
      const medals = ["🥇","🥈","🥉"];
      return `<ol class="standing-podium">${rows.slice(0, limit).map((r, i) => `
        <li class="standing-row t${i+1}">
          <span class="medal">${medals[i]||""}</span>
          <span class="name" data-student-name="${escapeHtml(r.name)}">${escapeHtml(r.name)}</span>
          <span class="pts">${r.points} pt</span>
        </li>`).join("")}</ol>`;
    }

    const overall = `
      <div class="standing-card">
        <h3>Overall</h3>
        <div class="standing-section">
          <div class="standing-label">Top 3 across all events</div>
          ${podium(all)}
        </div>
      </div>`;

    const byGender = `
      <div class="standing-card">
        <h3>By gender</h3>
        ${["Girls","Boys","Mixed"].map(g => {
          const rows = all.filter(r => r.gender === g);
          if (rows.length === 0) return "";
          return `
          <div class="standing-section">
            <div class="standing-label">${escapeHtml(g)}</div>
            ${podium(rows)}
          </div>`;
        }).join("") || `<div class="muted small">No results yet.</div>`}
      </div>`;

    let byBand = `
      <div class="standing-card">
        <h3>By age band</h3>`;
    if (ageBands.length === 0) {
      byBand += `<div class="muted small">Set age bands in Settings.</div>`;
    } else {
      byBand += ageBands.map(band => {
        const ages = parseBand(band);
        const rows = all.filter(r => [...r.ages].some(a => ageInBand(a, ages)));
        return `
          <div class="standing-section">
            <div class="standing-label">${escapeHtml(band)}</div>
            ${podium(rows)}
          </div>`;
      }).join("");
    }
    byBand += `</div>`;

    $("#overallStandings").innerHTML = overall + byGender + byBand;
  }

  function parseBand(band) {
    const parts = String(band).split(/[-–]/).map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
    if (parts.length === 1) return [parts[0], parts[0]];
    if (parts.length === 2) return [parts[0], parts[1]];
    return [0, 0];
  }
  function ageInBand(age, [lo, hi]) {
    const n = parseInt(age, 10);
    return !isNaN(n) && n >= lo && n <= hi;
  }
  function bandForAge(age) {
    const bands = state.school?.ageBands || [];
    for (const b of bands) {
      const [lo, hi] = parseBand(b);
      if (ageInBand(age, [lo, hi])) return b;
    }
    return null;
  }
  /** Returns the division name (e.g. "Junior") for a given age, or null. */
  function divisionForAge(age) {
    const divs = state.school?.divisions || [];
    for (const d of divs) {
      const [lo, hi] = d.ageRange || [0, 999];
      if (ageInBand(age, [lo, hi])) return d.name;
    }
    return null;
  }
  /**
   * Resolves rules text for an event — merges the base rule with any
   * division-specific override. eventRules[title] may be a plain string
   * (legacy) or { base, byDivision: { divisionName: text } }.
   */
  function rulesForEvent(ev) {
    const entry = (state.school?.eventRules || {})[ev.title];
    if (!entry) return "";
    if (typeof entry === "string") return entry;
    const base = entry.base || "";
    const div = divisionForAge(ev.age);
    const override = div && entry.byDivision ? entry.byDivision[div] : "";
    if (base && override) return base + "\n\n" + `[${div}] ${override}`;
    return base || override || "";
  }
  /** Returns the staff record for an event { Leader, Assistant, ... } or {}. */
  function staffForEvent(ev) {
    const all = state.school?.eventStaff || {};
    const entry = all[ev.title] || {};
    const div = divisionForAge(ev.age);
    return (div && entry[div]) || {};
  }

  function renderWalkupsBlock(events) {
    // Collect every walk-up across the school's events
    const walkups = [];
    events.forEach(ev => {
      (ev.competitors||[]).forEach(c => {
        if (c.walkup) walkups.push({ ev, c });
      });
    });
    const block = $("#walkupsBlock");
    const title = $("#walkupsTitle");
    if (walkups.length === 0) { block.hidden = true; title.hidden = true; return; }
    block.hidden = false; title.hidden = false;
    walkups.sort((a, b) => (b.c.walkupAt||0) - (a.c.walkupAt||0));
    block.innerHTML = `
      <table>
        <thead><tr><th>Competitor</th><th>Event</th><th>Added by</th><th>When</th><th>Tags</th><th></th></tr></thead>
        <tbody>
          ${walkups.map(w => {
            const missing = [];
            if (!w.c.grade) missing.push("grade");
            if (!w.c.house && (state.school?.houses||[]).length > 0) missing.push("house");
            if (!w.c.dob && !w.c.actualAge) missing.push("age");
            if (!w.c.bib) missing.push("bib");
            return `
              <tr>
                <td><strong data-student-name="${escapeHtml(w.c.name)}">${escapeHtml(w.c.name)}</strong></td>
                <td>${escapeHtml(w.ev.title)} <span class="muted small">— Age ${escapeHtml(w.ev.age)} ${escapeHtml(w.ev.gender)}</span></td>
                <td>${escapeHtml(w.c.walkupBy || "—")}</td>
                <td><span class="muted small">${escapeHtml(fmtDateTime(w.c.walkupAt))}</span></td>
                <td>${missing.length === 0 ? `<span style="color:var(--green);font-weight:600">✓ complete</span>` : `<span class="muted small">missing: ${missing.join(", ")}</span>`}</td>
                <td class="actions">
                  <button class="btn ghost" data-walkup-open="${escapeHtml(w.ev.id)}">Open</button>
                  <button class="btn" data-walkup-edit="${escapeHtml(w.ev.id)}|${escapeHtml(w.c.id)}">Edit</button>
                  <button class="btn primary" data-walkup-accept="${escapeHtml(w.ev.id)}|${escapeHtml(w.c.id)}">Accept</button>
                </td>
              </tr>`;
          }).join("")}
        </tbody>
      </table>`;
    block.querySelectorAll("[data-walkup-open]").forEach(b => b.addEventListener("click", () => openEventDetail(b.dataset.walkupOpen)));
    block.querySelectorAll("[data-walkup-accept]").forEach(b => b.addEventListener("click", async () => {
      const [eventId, cid] = b.dataset.walkupAccept.split("|");
      try {
        const resp = await api.updateCompetitor(eventId, cid, { walkup: false, walkupBy: "", walkupAt: null });
        const ev2 = state.events.find(e => e.id === eventId);
        const c = ev2?.competitors.find(x => x.id === cid);
        if (c && resp?.competitor) Object.assign(c, resp.competitor);
        renderAdmin();
        showToast("Walk-up accepted into the roster");
      } catch (e) { showToast("Couldn't update"); }
    }));
    block.querySelectorAll("[data-walkup-edit]").forEach(b => b.addEventListener("click", () => {
      const [eventId, cid] = b.dataset.walkupEdit.split("|");
      // Open event detail — admin can use the gear icon to fill in details
      openEventDetail(eventId);
    }));
  }

  function renderRecordsBlock() {
    const records = state.school?.records || [];
    const block = $("#recordsBlock");
    if (records.length === 0) {
      block.innerHTML = `<div class="records-empty">No school records yet. Set them in Settings, or wait for someone to set one in an event!</div>`;
      return;
    }
    const sorted = [...records].sort((a,b) => {
      // group by title, then age, then gender
      return (a.title||"").localeCompare(b.title||"") ||
             (parseInt(a.age,10)||0) - (parseInt(b.age,10)||0) ||
             (a.gender||"").localeCompare(b.gender||"");
    });
    const recently = (dateSet) => {
      if (!dateSet) return false;
      try { return (Date.now() - new Date(dateSet).getTime()) < 1000*60*60*24*30; } catch(e) { return false; }
    };
    block.innerHTML = `
      <table>
        <thead><tr><th>Event</th><th>Age</th><th>Gender</th><th>Record</th><th>Held by</th><th>Date</th></tr></thead>
        <tbody>
          ${sorted.map(r => `
            <tr>
              <td>${escapeHtml(r.title||"")}</td>
              <td>${escapeHtml(r.age||"")}</td>
              <td>${escapeHtml(r.gender||"")}</td>
              <td class="res">${fmtResult(r.value, r.type, r.unit)}${recently(r.dateSet) ? `<span class="new-since">NEW</span>`:""}</td>
              <td>${escapeHtml(r.holderName||"—")}</td>
              <td>${escapeHtml(r.dateSet||"—")}</td>
            </tr>`).join("")}
        </tbody>
      </table>`;
  }

  function computeTotalsByCategory(events, tieMethod) {
    const totals = {};
    events.forEach(ev => {
      if (ev.format === "team") return; // team events count for houses, not individuals
      const cat = `Age ${ev.age} ${ev.gender}`;
      const placements = computePlacements(ev, tieMethod);
      placements.forEach(p => {
        const c = (ev.competitors||[]).find(c => c.id === p.competitorId);
        if (!c) return;
        const key = (c.name||"").trim();
        if (!key) return;
        if (!totals[cat]) totals[cat] = new Map();
        totals[cat].set(key, (totals[cat].get(key) || 0) + (p.points || 0));
      });
    });
    const result = {};
    for (const cat of Object.keys(totals)) {
      result[cat] = [...totals[cat].entries()]
        .map(([name, points]) => ({ name, points: Math.round(points*100)/100 }))
        .sort((a,b) => b.points - a.points);
    }
    return result;
  }

  // ---------- Ribbons ----------
  function renderRibbons() {
    const onlyCompleted = $("#ribbonsOnlyCompleted").checked;
    const events = state.events.filter(e => onlyCompleted ? e.status === "completed" : true);
    const groups = {};
    events.forEach(e => { const cat = `Age ${e.age} ${e.gender}`; (groups[cat] = groups[cat] || []).push(e); });
    const keys = Object.keys(groups).sort();
    const container = $("#ribbonsContainer");
    if (keys.length === 0) { container.innerHTML = `<div class="empty-state"><div class="empty-icon">🎀</div><h2>No results yet</h2></div>`; return; }
    container.innerHTML = keys.map(k => {
      const evs = groups[k].sort((a,b) => a.title.localeCompare(b.title));
      return `
      <section class="ribbon-section">
        <h3>${escapeHtml(k)}</h3>
        ${evs.map(ev => {
          const placements = computePlacements(ev, state.school?.tieMethod || "average").filter(p => p.place != null).sort((a,b) => a.place - b.place);
          if (placements.length === 0) return "";
          return `
            <div style="margin-bottom:10px">
              <div style="font-weight:600;margin-bottom:4px">${escapeHtml(ev.title)}<span class="muted small"> · ${typeLabel(ev.type)}${ev.unit?` (${escapeHtml(ev.unit)})`:""}</span></div>
              <table class="ribbon-table">
                <thead><tr><th>Place</th><th>Competitor</th><th>Result</th><th class="pts">Pts</th></tr></thead>
                <tbody>
                  ${placements.map(p => {
                    const c = (ev.competitors||[]).find(c => c.id === p.competitorId);
                    const best = c ? bestOf(c.attempts, ev.type) : null;
                    const cls = ["","gold","silver","bronze","fourth"][Math.min(4, Math.floor(p.place))] || "";
                    return `<tr>
                      <td class="place ${cls}">${p.tied?"T-":""}${ordinal(p.place)}</td>
                      <td data-student-name="${escapeHtml(c?.name || "")}">${escapeHtml(c?.name || "")}</td>
                      <td class="res">${fmtResult(best, ev.type, ev.unit)}</td>
                      <td class="pts">${p.points}</td>
                    </tr>`;
                  }).join("")}
                  ${ev.status === "completed" ? (ev.competitors||[]).filter(c => bestOf(c.attempts, ev.type) == null).map(c => `
                    <tr class="compl"><td class="place">—</td><td>${escapeHtml(c.name)}</td><td class="res">Participation</td><td class="pts">${COMPLETION_POINTS}</td></tr>
                  `).join("") : ""}
                </tbody>
              </table>
            </div>`;
        }).join("")}
      </section>`;
    }).join("");
  }

  // ---------- Label sheet (1"x1" Avery print) ----------
  /**
   * Builds one label per ribbon-eligible result across all events:
   * - placement mode: every 1st/2nd/3rd (and optionally 4th) place winner
   * - standard mode:  every competitor who beat at least the bronze standard
   * Plus a participation label per non-placing competitor on completed events.
   */
  function buildLabels() {
    const tie = state.school?.tieMethod || "average";
    const scoring = state.school?.scoring || { placement: true, standard: false };
    const events = state.events.filter(e => e.status === "completed");
    const labels = [];
    events.forEach(ev => {
      const cat = `Age ${ev.age} ${ev.gender}`;
      if (scoring.placement) {
        const placements = computePlacements(ev, tie);
        placements.filter(p => p.place != null && p.place <= 4).forEach(p => {
          const c = (ev.competitors||[]).find(c => c.id === p.competitorId);
          const placeNames = ["1st","2nd","3rd","4th"];
          const cls = ["gold","silver","bronze","fourth"][Math.floor(p.place)-1] || "";
          labels.push({
            place: `${p.tied?"T-":""}${placeNames[Math.floor(p.place)-1]||ordinal(p.place)}`,
            placeClass: cls,
            name: c?.name || "",
            event: ev.title, cat,
            res: fmtResult(bestOf(c?.attempts, ev.type), ev.type, ev.unit) +
                 (didBeatPB(c, ev) ? " · PB" : "")
          });
        });
      }
      if (scoring.standard) {
        (ev.competitors||[]).forEach(c => {
          const best = bestOf(c.attempts, ev.type);
          if (best == null) return;
          const std = findStandardForCompetitor(ev, c);
          if (!std) return;
          const tier = tierForResult(best, std, ev.type);
          if (!tier) return;
          const placeNames = { gold:"Gold", silver:"Silver", bronze:"Bronze" };
          labels.push({
            place: placeNames[tier] + " Standard", placeClass: tier,
            name: c.name, event: ev.title, cat,
            res: fmtResult(best, ev.type, ev.unit) + (didBeatPB(c, ev) ? " · PB" : "")
          });
        });
      }
    });
    return labels;
  }

  /**
   * Resolves the relevant performance standard for a given (event, competitor).
   * Uses the competitor's actualAge band when set, otherwise falls back to the
   * event's age band — which means standards stay accurate to the kid's age
   * even in grade-grouped events.
   */
  function findStandardForCompetitor(ev, c) {
    const band = bandForAge((c?.actualAge) || ev.age);
    const std = (state.school?.standards || []).filter(s =>
      (s.title||"").toLowerCase() === (ev.title||"").toLowerCase() && s.gender === ev.gender);
    return std.find(s => s.ageBand === band) || std[0] || null;
  }

  /** Adds-or-updates a school-level personal best for (name, event title, gender). */
  async function savePersonalBest({ name, title, gender, value, type, unit }) {
    if (!state.school) return;
    if (!state.school.personalBests) state.school.personalBests = [];
    const key = (s) => (s||"").trim().toLowerCase();
    const existing = state.school.personalBests.find(p =>
      key(p.name) === key(name) && key(p.title) === key(title) && p.gender === gender);
    if (existing) {
      const better = type === "timed" ? value < existing.value : value > existing.value;
      if (!better) return existing;
      Object.assign(existing, { value, dateSet: new Date().toISOString().slice(0,10), unit, type });
    } else {
      state.school.personalBests.push({
        id: uid(),
        name, title, gender, value, type, unit,
        dateSet: new Date().toISOString().slice(0,10)
      });
    }
    try { await api.updateSchool({ personalBests: state.school.personalBests }); } catch (e) {}
    return existing;
  }

  /**
   * If a competitor's best result on an event beats their personal best,
   * (a) updates the PB, (b) shows a non-blocking toast (not the full horn —
   * that's reserved for school records).
   */
  async function checkForPBBreak(ev, c) {
    if (!ev || !c) return;
    const best = bestOf(c.attempts, ev.type);
    if (best == null) return;
    const pbs = state.school?.personalBests || [];
    const existing = pbs.find(p =>
      (p.name||"").trim().toLowerCase() === (c.name||"").trim().toLowerCase() &&
      (p.title||"").toLowerCase() === (ev.title||"").toLowerCase() &&
      p.gender === ev.gender);
    if (!existing) return; // no prior PB recorded — nothing to "beat"
    const better = ev.type === "timed" ? best < existing.value : best > existing.value;
    if (!better) return;
    await savePersonalBest({ name: c.name, title: ev.title, gender: ev.gender, value: best, type: ev.type, unit: ev.unit });
    showToast(`🌟 ${c.name} just beat their PB! (${fmtResult(existing.value, ev.type, ev.unit)} → ${fmtResult(best, ev.type, ev.unit)})`, 3500);
  }

  function didBeatPB(c, ev) {
    if (!c) return false;
    const pbs = state.school?.personalBests || [];
    const pb = pbs.find(p =>
      (p.name||"").trim().toLowerCase() === (c.name||"").trim().toLowerCase() &&
      (p.title||"").toLowerCase() === (ev.title||"").toLowerCase());
    if (!pb) return false;
    const best = bestOf(c.attempts, ev.type);
    if (best == null) return false;
    return ev.type === "timed" ? best < pb.value : best > pb.value;
  }

  function findStandardForEvent(ev) {
    const std = (state.school?.standards || []).filter(s => s.title === ev.title && s.gender === ev.gender);
    if (std.length === 0) return null;
    const band = bandForAge(ev.age);
    return std.find(s => s.ageBand === band) || std[0];
  }
  function tierForResult(value, std, type) {
    if (std == null) return null;
    const better = (a, b) => type === "timed" ? a <= b : a >= b;
    if (std.gold   != null && better(value, std.gold))   return "gold";
    if (std.silver != null && better(value, std.silver)) return "silver";
    if (std.bronze != null && better(value, std.bronze)) return "bronze";
    return null;
  }

  function renderLabelSheet() {
    const labels = buildLabels();
    const sheet = $("#labelSheet");
    if (labels.length === 0) {
      sheet.innerHTML = `<div class="empty-state"><div class="empty-icon">🎀</div><h2>No ribbons to print yet</h2><p>Submit some events first.</p></div>`;
      sheet.classList.add("previewing");
      sheet.hidden = false;
      return;
    }
    const PER_PAGE = 70; // 7 × 10
    let html = "";
    for (let pi = 0; pi < labels.length; pi += PER_PAGE) {
      const pageLabels = labels.slice(pi, pi + PER_PAGE);
      html += `<div class="label-sheet-page">${pageLabels.map(l => `
        <div class="label">
          <div class="l-place ${l.placeClass}">${escapeHtml(l.place)}</div>
          <div class="l-name">${escapeHtml(l.name)}</div>
          <div class="l-event">${escapeHtml(l.event)}</div>
          <div class="l-cat">${escapeHtml(l.cat)}</div>
          <div class="l-res">${escapeHtml(l.res)}</div>
        </div>`).join("")}</div>`;
    }
    sheet.innerHTML = html;
    sheet.classList.add("previewing");
    sheet.hidden = false;
  }
  function printLabels() {
    renderLabelSheet();
    setTimeout(() => {
      window.print();
      // After print, hide preview again
      setTimeout(() => {
        $("#labelSheet").classList.remove("previewing");
        $("#labelSheet").hidden = true;
      }, 500);
    }, 100);
  }

  // ---------- Announcer ----------
  function updateAnnounceBadge() {
    const queue = (state.announceQueue||[]).filter(id => state.events.find(e => e.id === id));
    const badge = $("#announceBadge");
    if (queue.length > 0) { badge.textContent = queue.length; badge.hidden = false; }
    else { badge.hidden = true; }
  }
  function renderAnnounce() {
    if ((state.announceQueue||[]).length === 0) {
      $("#announceCard").hidden = true;
      $("#announceEmpty").hidden = false;
      updateAnnounceBadge();
      return;
    }
    $("#announceEmpty").hidden = true;
    $("#announceCard").hidden = false;
    const evId = state.announceQueue[0];
    const ev = state.events.find(e => e.id === evId);
    if (!ev) { state.announceQueue.shift(); return renderAnnounce(); }
    const placements = computePlacements(ev, state.school?.tieMethod || "average").filter(p => p.place != null).sort((a,b) => a.place - b.place);
    $("#announceEyebrow").textContent = `Age ${ev.age} ${ev.gender} · ${typeLabel(ev.type)}`;
    $("#announceTitle").textContent = ev.title;
    const medals = ["🥇","🥈","🥉","🏅"];
    $("#announceResults").innerHTML = placements.slice(0, 4).map(p => {
      const c = (ev.competitors||[]).find(c => c.id === p.competitorId);
      const best = c ? bestOf(c.attempts, ev.type) : null;
      const placeIdx = Math.min(3, Math.floor(p.place)-1);
      const cls = ["gold","silver","bronze",""][placeIdx] || "";
      return `<li class="${cls}">
        <div class="place-block">
          <div class="place-medal">${medals[placeIdx]||""}</div>
          <div>
            <div class="name" data-student-name="${escapeHtml(c?.name||"")}">${escapeHtml(c?.name||"")}</div>
            <div class="muted small">${p.tied?"Tied for ":""}${ordinal(p.place)} · ${p.points} pts</div>
          </div>
        </div>
        <div class="result-val">${fmtResult(best, ev.type, ev.unit)}</div>
      </li>`;
    }).join("");
    $("#announceQueueInfo").textContent = state.announceQueue.length > 1
      ? `${state.announceQueue.length - 1} more event${state.announceQueue.length-1===1?"":"s"} queued.`
      : "";
    updateAnnounceBadge();
    updateCompletionBar();
  }
  async function markAnnounced() {
    const evId = state.announceQueue[0];
    if (!evId) return;
    try {
      await api.markAnnounced(evId);
      state.announceQueue = state.announceQueue.filter(id => id !== evId);
      const ev = state.events.find(e => e.id === evId);
      if (ev) ev.announcedAt = Date.now();
      renderAnnounce();
    } catch (e) { showToast("Update failed"); }
  }
  async function skipAnnounceCurrent() {
    const evId = state.announceQueue[0];
    if (!evId) return;
    try {
      await api.skipAnnounce(evId);
      state.announceQueue = state.announceQueue.filter(id => id !== evId);
      state.announceQueue.push(evId);
      renderAnnounce();
    } catch (e) { showToast("Update failed"); }
  }
  // ---------- Report a problem / suggestion ----------
  function openReportModal() {
    const session = api.getSession();
    $("#reportMessage").value = "";
    $("#reportName").value  = session?.leaderName || session?.email || "";
    $("#reportEmail").value = session?.email || "";
    $("#reportModal").hidden = false;
    setTimeout(() => $("#reportMessage").focus(), 30);
  }
  async function sendReport() {
    const message = $("#reportMessage").value.trim();
    if (!message) { showToast("Tell us what's wrong"); return; }
    const kind = document.querySelector("input[name='reportKind']:checked")?.value || "suggestion";
    const session = api.getSession();
    const ctx = {
      view:   $$(".tab.active").map(t => t.dataset.tab)[0] || (document.getElementById("view-event-detail")?.hidden === false ? "event-detail" : null),
      eventId: currentEventId || null,
      role:    session?.role || null,
      url:     location.href,
      ua:      navigator.userAgent,
      mode:    api.getMode ? api.getMode() : null
    };
    $("#btnReportSend").disabled = true;
    try {
      const out = await api.report({
        kind, message,
        fromName:  $("#reportName").value.trim(),
        fromEmail: $("#reportEmail").value.trim().toLowerCase(),
        schoolCode: state.school?.code || "",
        context: ctx
      });
      $("#reportModal").hidden = true;
      showToast(out?.sent ? "Thanks — we got it 🙏" : "Saved locally; we'll get it next time you're online");
    } catch (e) {
      showToast("Couldn't send — try again");
    } finally {
      $("#btnReportSend").disabled = false;
    }
  }

  // ---------- Refer-to-school ----------
  function openReferModal() {
    const session = api.getSession();
    $("#referTeacherName").value = "";
    $("#referTeacherEmail").value = "";
    $("#referSchoolName").value = "";
    $("#referSenderName").value = session?.leaderName || "";
    $("#referSenderSchool").value = state.school?.name || "";
    $("#referModal").hidden = false;
    setTimeout(() => $("#referTeacherName").focus(), 30);
  }
  async function sendRefer() {
    const products = $$("input[name='referProducts']:checked").map(cb => cb.value);
    if (products.length === 0) { showToast("Pick at least one product to recommend"); return; }
    const payload = {
      teacherName:  $("#referTeacherName").value.trim(),
      teacherEmail: $("#referTeacherEmail").value.trim().toLowerCase(),
      schoolName:   $("#referSchoolName").value.trim(),
      senderName:   $("#referSenderName").value.trim(),
      senderSchool: $("#referSenderSchool").value.trim(),
      products
    };
    if (!payload.teacherName || !payload.teacherEmail || !payload.senderName) { showToast("Please fill in their name, their email, and your name"); return; }
    if (!payload.teacherEmail.includes("@")) { showToast("That doesn't look like a valid email"); return; }
    $("#btnReferSend").disabled = true;
    try {
      const out = await api.refer(payload);
      $("#referModal").hidden = true;
      showToast(out?.sent ? `Recommendation sent to ${payload.teacherName}` : "Couldn't send — try again later");
    } catch (e) {
      showToast("Couldn't send — try again later");
    } finally {
      $("#btnReferSend").disabled = false;
    }
  }

  async function refreshAnnounce() {
    await refreshState();
    renderAnnounce();
    showToast("Refreshed");
  }

  // ---------- Settings ----------
  function renderSettings() {
    const school = state.school;
    if (!school) return;
    if (!school.eventRules) school.eventRules = {};
    $$("input[name='tieMethod']").forEach(r => r.checked = (r.value === school.tieMethod));
    const scoring = school.scoring || {
      placement: (school.scoringMode || "placement") !== "standard",
      standard:  (school.scoringMode || "placement") === "standard"
    };
    $("#scoringPlacement").checked = !!scoring.placement;
    $("#scoringStandard").checked  = !!scoring.standard;
    $("#ageCategories").value = (school.ageCategories||[]).join(", ");
    $("#ageBands").value = (school.ageBands||[]).join(", ");
    $("#ageCutoffDate").value = school.ageCutoffDate || "12-31";
    $("#eventLibrary").value = (school.eventLibrary||[]).join("\n");
    $("#standardsCard").hidden = !scoring.standard;
    $("#houseList").value = (school.houses||[]).join(", ");
    renderSchoolCodeCard();
    renderInviteLeadersPanel();
    renderDivisionsEditor();
    renderLibraryEditor();
    renderRulesEditor();
    renderRecordsEditor();
    renderStandardsEditor();
    renderArchives();
  }

  function renderLibraryEditor() {
    const school = state.school; if (!school) return;
    const lib = school.eventLibrary || [];
    const defaults = school.eventDefaults || {};
    const wrap = $("#eventLibraryEditor");
    wrap.innerHTML = lib.map(title => {
      const d = defaults[title] || {};
      const inferred = inferEventType(title);
      const type = d.type || inferred.type;
      const attempts = d.attempts != null ? d.attempts : inferred.attempts;
      const unit = d.unit != null ? d.unit : inferred.unit;
      return `
        <div class="library-row" data-title="${escapeHtml(title)}">
          <input class="lib-title" data-f="title" value="${escapeHtml(title)}" />
          <select data-f="type">
            <option value="timed"    ${type==="timed"?"selected":""}>Timed</option>
            <option value="distance" ${type==="distance"?"selected":""}>Distance</option>
            <option value="weight"   ${type==="weight"?"selected":""}>Weight</option>
          </select>
          <input data-f="attempts" type="number" min="1" max="10" value="${attempts}" />
          <input data-f="unit" value="${escapeHtml(unit)}" placeholder="unit" />
          <button class="icon-btn" data-del-lib="${escapeHtml(title)}" title="Remove">🗑</button>
        </div>`;
    }).join("");
    wrap.querySelectorAll("[data-del-lib]").forEach(btn => btn.addEventListener("click", () => {
      const t = btn.dataset.delLib;
      state.school.eventLibrary = (state.school.eventLibrary||[]).filter(x => x !== t);
      renderLibraryEditor();
    }));
  }
  function renderDivisionsEditor() {
    const school = state.school; if (!school) return;
    if (!school.divisions) school.divisions = [];
    const wrap = $("#divisionsEditor");
    wrap.innerHTML = school.divisions.map((d, i) => `
      <div class="division-row" data-idx="${i}">
        <input data-f="name" value="${escapeHtml(d.name||"")}" placeholder="Division name" />
        <input data-f="lo"   type="number" value="${(d.ageRange||[0,0])[0]}" placeholder="Min age" />
        <input data-f="hi"   type="number" value="${(d.ageRange||[0,0])[1]}" placeholder="Max age" />
        <button class="icon-btn" data-del-div="${i}" title="Remove">🗑</button>
      </div>
    `).join("");
    wrap.querySelectorAll("[data-del-div]").forEach(btn => btn.addEventListener("click", () => {
      const idx = parseInt(btn.dataset.delDiv, 10);
      state.school.divisions.splice(idx, 1);
      renderDivisionsEditor();
    }));
  }
  function addDivision() {
    const name = $("#newDivName").value.trim();
    const lo = parseInt($("#newDivLow").value, 10);
    const hi = parseInt($("#newDivHigh").value, 10);
    if (!name || isNaN(lo) || isNaN(hi)) { showToast("Need a name and age range"); return; }
    if (!state.school.divisions) state.school.divisions = [];
    state.school.divisions.push({ name, ageRange: [lo, hi] });
    ["newDivName","newDivLow","newDivHigh"].forEach(id => $("#"+id).value = "");
    renderDivisionsEditor();
  }
  async function saveDivisions() {
    const rows = $$("#divisionsEditor .division-row");
    const list = [];
    rows.forEach(row => {
      const fields = {};
      row.querySelectorAll("[data-f]").forEach(f => fields[f.dataset.f] = f.value);
      const name = (fields.name || "").trim();
      const lo = parseInt(fields.lo, 10), hi = parseInt(fields.hi, 10);
      if (name && !isNaN(lo) && !isNaN(hi)) list.push({ name, ageRange: [lo, hi] });
    });
    try {
      const resp = await api.updateSchool({ divisions: list });
      if (resp?.school) state.school = resp.school;
      showToast("Divisions saved");
    } catch (e) { showToast("Save failed"); }
  }

  async function saveHouses() {
    const list = $("#houseList").value.split(",").map(s => s.trim()).filter(Boolean);
    try {
      const resp = await api.updateSchool({ houses: list });
      if (resp?.school) state.school = resp.school;
      showToast("Houses saved");
    } catch (e) { showToast("Save failed"); }
  }

  function renderHouseStandings(events) {
    const houses = state.school?.houses || [];
    const wrap = $("#houseStandings");
    if (houses.length === 0) {
      wrap.innerHTML = `<div class="muted small">Set your school's houses in Settings to enable house scoring.</div>`;
      return;
    }
    const tie = state.school?.tieMethod || "average";
    const totals = new Map(houses.map(h => [h, { points: 0, kids: new Set() }]));
    events.forEach(ev => {
      const placements = computePlacements(ev, tie);
      placements.forEach(p => {
        const c = (ev.competitors||[]).find(c => c.id === p.competitorId);
        if (!c?.house || !totals.has(c.house)) return;
        const entry = totals.get(c.house);
        entry.points += (p.points || 0);
        if (c.name) entry.kids.add(c.name.trim().toLowerCase());
      });
    });
    const ranked = [...totals.entries()].map(([name, e]) => ({ name, points: Math.round(e.points*100)/100, kids: e.kids.size }))
      .sort((a,b) => b.points - a.points);
    const top = ranked.length > 0 ? ranked[0].points : 0;
    wrap.innerHTML = ranked.map(h => `
      <div class="house-card ${h.points === top && top > 0 ? "winner" : ""}">
        ${h.points === top && top > 0 ? `<div class="house-crown">👑</div>` : ""}
        <div class="house-name">${escapeHtml(h.name)}</div>
        <div class="house-points">${h.points}</div>
        <div class="house-meta">${h.kids} competitor${h.kids===1?"":"s"}</div>
      </div>`).join("");
  }

  async function addLibTitle() {
    const t = $("#newLibTitle").value.trim();
    if (!t) return;
    if (!state.school.eventLibrary) state.school.eventLibrary = [];
    if (state.school.eventLibrary.includes(t)) { showToast("Already in library"); return; }
    state.school.eventLibrary.push(t);
    $("#newLibTitle").value = "";
    renderLibraryEditor();
  }

  /**
   * Lists every staff name (collected from school.eventStaff across all
   * events/divisions/roles) with an email field and a Send Invite button.
   * Stores entered emails locally so the admin doesn't have to retype.
   */
  function collectStaffNames() {
    const staff = state.school?.eventStaff || {};
    const set = new Set();
    Object.values(staff).forEach(byDiv => Object.values(byDiv || {}).forEach(byRole =>
      Object.values(byRole || {}).forEach(n => { if (n && String(n).trim()) set.add(String(n).trim()); })));
    return [...set].sort();
  }

  function renderInviteLeadersPanel() {
    const school = state.school; if (!school) return;
    const requireToggle = $("#requireLeaderPinToggle");
    if (requireToggle) requireToggle.checked = !!school.requireLeaderPin;
    const restrictToggle = $("#restrictTimerStartsToggle");
    if (restrictToggle) restrictToggle.checked = !!school.restrictTimerStarts;

    const names = collectStaffNames();
    const emails = school.staffEmails || {};
    const pinStatus = school.staffPinStatus || {};
    const wrap = $("#inviteLeadersList");
    if (!wrap) return;
    if (names.length === 0) {
      wrap.innerHTML = `<div class="muted small">No staff names yet. Add them via the Staff tab in your Excel workbook upload, then come back here.</div>`;
      return;
    }
    wrap.innerHTML = names.map(name => {
      const key = name.toLowerCase().trim();
      const email = emails[key] || "";
      const pi = pinStatus[key] || {};
      let status = "";
      if (school.requireLeaderPin && pi.hasPin) status = `<span class="ir-status has-pin">PIN set</span>`;
      else if (school.requireLeaderPin)         status = `<span class="ir-status">no PIN yet</span>`;
      else if (pi.sentAt)                        status = `<span class="ir-status sent">sent</span>`;
      return `
        <div class="invite-row" data-name="${escapeHtml(name)}">
          <div class="ir-name">${escapeHtml(name)}</div>
          <input type="email" data-invite-email value="${escapeHtml(email)}" placeholder="leader@school.org" autocomplete="off" />
          <div>${status}</div>
          <button class="btn" data-invite-send>Send Invite</button>
        </div>`;
    }).join("");

    wrap.querySelectorAll("[data-invite-send]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const row = btn.closest(".invite-row");
        const name = row.dataset.name;
        const email = row.querySelector("[data-invite-email]").value.trim().toLowerCase();
        if (!email || !email.includes("@")) { showToast("Enter a valid email"); return; }
        await inviteOneLeader(name, email, true /* always regenerate so we can email a fresh PIN */);
      });
    });
  }

  async function inviteOneLeader(name, email, regeneratePin) {
    try {
      const out = await api.inviteLeader({ name, email, regeneratePin });
      showToast(out?.sent ? `Invite sent to ${name}` : `Couldn't email ${name} — try again later`);
      // Refresh state so PIN status pills update
      await refreshState();
      renderInviteLeadersPanel();
      return out;
    } catch (e) {
      showToast(`Couldn't invite ${name}`);
      return { sent: false };
    }
  }

  async function inviteAllLeaders() {
    const rows = $$("#inviteLeadersList .invite-row");
    const queue = rows
      .map(r => ({ name: r.dataset.name, email: r.querySelector("[data-invite-email]").value.trim().toLowerCase() }))
      .filter(x => x.email && x.email.includes("@"));
    if (queue.length === 0) { showToast("Add at least one email"); return; }
    if (!confirm(`Send invite emails to ${queue.length} leader${queue.length===1?"":"s"}? Each gets a freshly-generated PIN.`)) return;
    let sent = 0, failed = 0;
    for (const q of queue) {
      const out = await inviteOneLeader(q.name, q.email, true);
      if (out?.sent) sent++; else failed++;
    }
    $("#inviteSummary").textContent = `${sent} sent · ${failed} failed`;
    showToast(`${sent} of ${queue.length} invites sent`);
  }

  /**
   * Print-friendly fallback for admins who'd rather hand out paper. Builds
   * a single sheet with name / email / PIN columns. PINs are only printable
   * for staff invited in the current session (PINs in the DB are hashed).
   */
  function printCredentialsSheet() {
    const school = state.school; if (!school) return;
    const names = collectStaffNames();
    const emails = school.staffEmails || {};
    $("#credPrintTitle").textContent = `${school.name} · Field Day Event Leader Credentials`;
    $("#credPrintSub").textContent  = `School code: ${school.code}${school.requireLeaderPin ? " · PIN required" : ""}`;
    const rows = names.map(n => {
      const key = n.toLowerCase().trim();
      // We can't recover hashed PINs — leave the cell blank with a note that
      // each leader's PIN was emailed to them. Admin can regenerate if lost.
      return `<tr>
        <td>${escapeHtml(n)}</td>
        <td>${escapeHtml(emails[key] || "")}</td>
        <td class="code">${school.requireLeaderPin ? "(emailed — Send Invite to regenerate)" : "—"}</td>
      </tr>`;
    }).join("");
    $("#credPrintBody").innerHTML = rows;
    document.body.classList.add("printing-creds");
    setTimeout(() => {
      window.print();
      setTimeout(() => document.body.classList.remove("printing-creds"), 300);
    }, 100);
  }

  async function saveRequireLeaderPin() {
    const v = $("#requireLeaderPinToggle").checked;
    try {
      const resp = await api.updateSchool({ requireLeaderPin: v });
      if (resp?.school) state.school = resp.school;
      showToast(v ? "Leader PIN now required" : "Leader PIN no longer required");
      renderInviteLeadersPanel();
    } catch (e) { showToast("Save failed"); }
  }

  async function saveRestrictTimerStarts() {
    const v = $("#restrictTimerStartsToggle").checked;
    try {
      const resp = await api.updateSchool({ restrictTimerStarts: v });
      if (resp?.school) state.school = resp.school;
      showToast(v
        ? "Only assigned leaders can Start/Reset races now"
        : "Any helper can Start/Reset races now");
      renderInviteLeadersPanel();
    } catch (e) { showToast("Save failed"); }
  }

  function renderSchoolCodeCard() {
    const school = state.school; if (!school) return;
    $("#currentSchoolCode").textContent = school.code || "—";
    $("#masterAdminLine").innerHTML = school.masterAdminEmail
      ? `Master admin: <strong>${escapeHtml(school.masterAdminEmail)}</strong>`
      : "";
    const admins = (school.adminEmails || (school.adminEmail ? [school.adminEmail] : []));
    $("#adminListLine").innerHTML = admins.length > 1
      ? `Admins (${admins.length}): ${admins.map(escapeHtml).join(", ")}`
      : "";
  }
  let pendingDevConfirmCode = null;
  async function startCodeChange() {
    try {
      const out = await api.requestSchoolCodeChange();
      $("#masterEmailEcho").textContent = out.masterAdminEmail || state.school?.masterAdminEmail || "the master admin";
      $("#codeChangeFlow").hidden = false;
      pendingDevConfirmCode = out.devConfirmationCode || null;
      const hint = $("#codeChangeDevHint");
      if (pendingDevConfirmCode) {
        hint.hidden = false;
        hint.innerHTML = `<strong>Dev mode:</strong> confirmation code is <code style="font-family:monospace">${escapeHtml(pendingDevConfirmCode)}</code>`;
      } else {
        hint.hidden = true;
      }
      setTimeout(() => $("#newSchoolCode").focus(), 30);
    } catch (e) { showToast("Couldn't start code change"); }
  }
  function cancelCodeChange() {
    $("#codeChangeFlow").hidden = true;
    $("#newSchoolCode").value = "";
    $("#confirmationCode").value = "";
    pendingDevConfirmCode = null;
  }
  async function confirmCodeChange() {
    const newCode = $("#newSchoolCode").value.trim();
    const confirmation = $("#confirmationCode").value.trim();
    if (!newCode || !confirmation) { showToast("Both fields are required"); return; }
    try {
      const out = await api.confirmSchoolCodeChange(newCode, confirmation);
      if (out?.school) state.school = { ...state.school, ...out.school };
      cancelCodeChange();
      renderSettings();
      showToast(`School code changed to ${state.school.code}`);
    } catch (e) {
      if (e.message === "code_taken") showToast("That code is already in use");
      else if (e.code === 401)        showToast("Confirmation code didn't match");
      else                             showToast("Code change failed");
    }
  }
  function startInvite() {
    $("#inviteFlow").hidden = false;
    setTimeout(() => $("#inviteEmail").focus(), 30);
  }
  function cancelInvite() {
    $("#inviteFlow").hidden = true;
    $("#inviteEmail").value = "";
  }
  async function sendInvite() {
    const email = $("#inviteEmail").value.trim().toLowerCase();
    if (!email || !email.includes("@")) { showToast("Enter a valid email"); return; }
    try {
      const out = await api.inviteAdmin(email);
      cancelInvite();
      if (out?.sent) showToast(`Invite sent to ${email}`);
      else showToast(`Share the school code (${state.school.code}) — backend not configured to send`);
    } catch (e) { showToast("Couldn't send invite"); }
  }
  async function saveTieMethod(v) {
    try {
      const resp = await api.updateSchool({ tieMethod: v });
      if (resp?.school) state.school = resp.school;
      showToast("Tie method updated");
    } catch (e) { showToast("Save failed"); }
  }
  async function saveScoring() {
    const placement = $("#scoringPlacement").checked;
    const standard  = $("#scoringStandard").checked;
    if (!placement && !standard) {
      showToast("Pick at least one scoring mode");
      // revert
      const cur = state.school?.scoring || { placement: true, standard: false };
      $("#scoringPlacement").checked = !!cur.placement;
      $("#scoringStandard").checked  = !!cur.standard;
      return;
    }
    try {
      const resp = await api.updateSchool({ scoring: { placement, standard } });
      if (resp?.school) state.school = resp.school;
      $("#standardsCard").hidden = !standard;
      renderStandardsEditor();
      showToast("Scoring updated");
    } catch (e) { showToast("Save failed"); }
  }
  async function saveAges() {
    const cats  = $("#ageCategories").value.split(",").map(s => s.trim()).filter(Boolean);
    const bands = $("#ageBands").value.split(",").map(s => s.trim()).filter(Boolean);
    const cutoff = $("#ageCutoffDate").value.trim() || "12-31";
    if (cats.length === 0)  { showToast("Need at least one age category"); return; }
    if (bands.length === 0) { showToast("Need at least one age band"); return; }
    if (!/^\d{1,2}-\d{1,2}$/.test(cutoff)) { showToast("Cutoff date must be MM-DD"); return; }
    try {
      const resp = await api.updateSchool({ ageCategories: cats, ageBands: bands, ageCutoffDate: cutoff });
      if (resp?.school) state.school = resp.school;
      showToast("Saved");
    } catch (e) { showToast("Save failed"); }
  }

  // ---------- Rules editor ----------
  function renderRulesEditor() {
    const school = state.school; if (!school) return;
    const lib = school.eventLibrary || [];
    const rules = school.eventRules || {};
    $("#eventRulesEditor").innerHTML = lib.map(title => `
      <div class="rule-row" data-title="${escapeHtml(title)}">
        <div class="rule-title">${escapeHtml(title)}</div>
        <textarea data-rule="${escapeHtml(title)}" rows="2" placeholder="Pre-populated rules shown to event leaders…">${escapeHtml(rules[title] || "")}</textarea>
      </div>
    `).join("");
  }
  async function saveRules() {
    const school = state.school; if (!school) return;
    const updated = { ...(school.eventRules||{}) };
    $$("textarea[data-rule]").forEach(t => { updated[t.dataset.rule] = t.value.trim(); });
    try {
      const resp = await api.updateSchool({ eventRules: updated });
      if (resp?.school) state.school = resp.school;
      showToast("Rules saved");
    } catch (e) { showToast("Save failed"); }
  }

  // ---------- Records editor ----------
  function renderRecordsEditor() {
    const school = state.school; if (!school) return;
    const records = school.records || [];
    const wrap = $("#recordsEditor");
    if (records.length === 0) { wrap.innerHTML = `<div class="muted small">No records yet — add one below or wait for a competitor to set one.</div>`; }
    else {
      const sorted = [...records].sort((a,b) => (a.title||"").localeCompare(b.title||""));
      wrap.innerHTML = sorted.map(r => `
        <div class="record-edit-row" data-id="${r.id}">
          <input value="${escapeHtml(r.title||"")}" data-f="title" />
          <input value="${escapeHtml(r.age||"")}" data-f="age" />
          <select data-f="gender">${["Girls","Boys","Mixed"].map(g => `<option ${g===r.gender?"selected":""}>${g}</option>`).join("")}</select>
          <select data-f="type">${["timed","distance","weight"].map(t => `<option value="${t}" ${t===r.type?"selected":""}>${t}</option>`).join("")}</select>
          <input value="${escapeHtml(String(r.value??""))}" data-f="value" />
          <input value="${escapeHtml(r.holderName||"")}" data-f="holderName" placeholder="Held by" />
          <input type="date" value="${escapeHtml(r.dateSet||"")}" data-f="dateSet" />
          <button class="icon-btn" data-del-record="${r.id}" title="Delete">🗑</button>
        </div>`).join("");
      wrap.querySelectorAll(".record-edit-row").forEach(row => {
        row.querySelectorAll("input,select").forEach(field => {
          field.addEventListener("change", async () => {
            const id = row.dataset.id;
            const patch = {};
            row.querySelectorAll("[data-f]").forEach(f => {
              let v = f.value;
              if (f.dataset.f === "value") v = parseFloat(v);
              patch[f.dataset.f] = v;
            });
            try {
              const resp = await api.updateRecord(id, patch);
              const idx = state.school.records.findIndex(r => r.id === id);
              if (idx >= 0 && resp?.record) state.school.records[idx] = resp.record;
            } catch (e) { showToast("Save failed"); }
          });
        });
      });
      wrap.querySelectorAll("[data-del-record]").forEach(btn => btn.addEventListener("click", async () => {
        if (!confirm("Delete this record?")) return;
        try {
          await api.deleteRecord(btn.dataset.delRecord);
          state.school.records = state.school.records.filter(r => r.id !== btn.dataset.delRecord);
          renderRecordsEditor();
        } catch (e) { showToast("Delete failed"); }
      }));
    }
  }
  async function addRecord() {
    const rec = {
      title: $("#recTitle").value.trim(),
      age: $("#recAge").value.trim(),
      gender: $("#recGender").value,
      type: $("#recType").value,
      value: parseFloat($("#recValue").value),
      holderName: $("#recHolder").value.trim(),
      dateSet: $("#recDate").value || new Date().toISOString().slice(0,10)
    };
    if (!rec.title || !rec.age || isNaN(rec.value)) { showToast("Title, age and value are required"); return; }
    try {
      const resp = await api.createRecord(rec);
      if (!state.school.records) state.school.records = [];
      if (resp?.record) state.school.records.push(resp.record);
      ["recTitle","recAge","recValue","recHolder","recDate"].forEach(id => $("#"+id).value = "");
      renderRecordsEditor();
      showToast("Record added");
    } catch (e) { showToast("Save failed"); }
  }

  // ---------- Standards editor ----------
  function renderStandardsEditor() {
    const school = state.school; if (!school) return;
    if (!school.standards) school.standards = [];
    const titles = [...new Set(school.standards.map(s => s.title))].sort();
    const lib = school.eventLibrary || [];
    const allTitles = [...new Set([...lib, ...titles])];
    const sel = $("#standardsTitleFilter");
    const cur = sel.value || allTitles[0] || "";
    sel.innerHTML = allTitles.map(t => `<option ${t===cur?"selected":""}>${escapeHtml(t)}</option>`).join("");
    const title = sel.value;
    const rows = school.standards.filter(s => s.title === title)
      .sort((a,b) => (a.ageBand||"").localeCompare(b.ageBand||"") || (a.gender||"").localeCompare(b.gender||""));
    const wrap = $("#standardsEditor");
    if (rows.length === 0) {
      wrap.innerHTML = `<div class="muted small">No standards defined for this event yet. Click <strong>Re-seed defaults</strong>, or add manually below.</div>
        <div class="standard-row">
          <select id="newStdBand">${(school.ageBands||[]).map(b => `<option>${escapeHtml(b)}</option>`).join("")}</select>
          <select id="newStdGender">${["Girls","Boys"].map(g => `<option>${g}</option>`).join("")}</select>
          <input id="newStdGold" placeholder="Gold" />
          <input id="newStdSilver" placeholder="Silver" />
          <input id="newStdBronze" placeholder="Bronze" />
          <button class="btn" id="btnAddStandard">Add</button>
        </div>`;
      $("#btnAddStandard")?.addEventListener("click", () => addStandard(title));
      return;
    }
    wrap.innerHTML = rows.map(s => `
      <div class="standard-row" data-id="${s.id}">
        <div class="sd-band">${escapeHtml(s.ageBand||"")}</div>
        <div class="sd-gender">${escapeHtml(s.gender||"")}</div>
        <input class="sd-gold"   data-f="gold"   value="${escapeHtml(String(s.gold ?? ""))}" />
        <input class="sd-silver" data-f="silver" value="${escapeHtml(String(s.silver ?? ""))}" />
        <input class="sd-bronze" data-f="bronze" value="${escapeHtml(String(s.bronze ?? ""))}" />
        <button class="icon-btn" data-del-std="${s.id}" title="Delete">🗑</button>
      </div>
    `).join("");
    wrap.querySelectorAll(".standard-row").forEach(row => {
      row.querySelectorAll("input").forEach(inp => {
        inp.addEventListener("change", async () => {
          const id = row.dataset.id;
          const patch = {};
          row.querySelectorAll("[data-f]").forEach(f => patch[f.dataset.f] = parseFloat(f.value));
          try {
            const resp = await api.updateStandard(id, patch);
            const idx = state.school.standards.findIndex(s => s.id === id);
            if (idx >= 0 && resp?.standard) state.school.standards[idx] = resp.standard;
          } catch (e) { showToast("Save failed"); }
        });
      });
    });
    wrap.querySelectorAll("[data-del-std]").forEach(btn => btn.addEventListener("click", async () => {
      try {
        await api.deleteStandard(btn.dataset.delStd);
        state.school.standards = state.school.standards.filter(s => s.id !== btn.dataset.delStd);
        renderStandardsEditor();
      } catch (e) { showToast("Delete failed"); }
    }));
  }
  async function addStandard(title) {
    const band = $("#newStdBand").value;
    const gender = $("#newStdGender").value;
    const gold = parseFloat($("#newStdGold").value);
    const silver = parseFloat($("#newStdSilver").value);
    const bronze = parseFloat($("#newStdBronze").value);
    if ([gold,silver,bronze].some(isNaN)) { showToast("Need numbers for all three levels"); return; }
    try {
      const resp = await api.createStandard({ title, ageBand: band, gender, gold, silver, bronze });
      if (resp?.standard) state.school.standards.push(resp.standard);
      renderStandardsEditor();
    } catch (e) { showToast("Save failed"); }
  }
  async function reseedStandards() {
    const school = state.school; if (!school) return;
    if (!confirm("Re-seed default standards for any event in your library that has a built-in template?\n\nExisting custom standards for those events will be REPLACED.")) return;
    const seed = api.seedStandards(school.ageBands||[], school.eventLibrary||[]);
    // Remove existing standards for any seeded title, then add the new ones.
    const seededTitles = new Set(seed.map(s => s.title));
    const keep = (school.standards||[]).filter(s => !seededTitles.has(s.title));
    try {
      // Delete the ones we're going to replace
      const toDelete = (school.standards||[]).filter(s => seededTitles.has(s.title));
      for (const s of toDelete) await api.deleteStandard(s.id);
      // Add the new seed
      for (const s of seed) await api.createStandard(s);
      // Refresh local cache
      await refreshState();
      renderSettings();
      showToast("Standards re-seeded");
    } catch (e) { showToast("Re-seed failed"); }
  }
  async function saveLibrary() {
    const rows = $$("#eventLibraryEditor .library-row");
    const list = [];
    const defaults = {};
    rows.forEach(row => {
      const fields = {};
      row.querySelectorAll("[data-f]").forEach(f => fields[f.dataset.f] = f.value);
      const title = (fields.title || "").trim();
      if (!title) return;
      list.push(title);
      defaults[title] = {
        type: fields.type || "timed",
        attempts: Math.max(1, Math.min(10, parseInt(fields.attempts, 10) || 1)),
        unit: (fields.unit || "").trim()
      };
    });
    if (list.length === 0) { showToast("Need at least one event title"); return; }
    try {
      const resp = await api.updateSchool({ eventLibrary: list, eventDefaults: defaults });
      if (resp?.school) state.school = resp.school;
      showToast("Library saved");
    } catch (e) { showToast("Save failed"); }
  }

  // ---------- Archives ----------
  function defaultArchiveLabel() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const startYear = month >= 7 ? year : year - 1;
    return `${startYear}-${String((startYear+1)%100).padStart(2,"0")}`;
  }
  function renderArchives() {
    const school = state.school;
    if (!school) return;
    if (!school.archives) school.archives = [];
    const events = state.events;
    const completed = events.filter(e => e.status === "completed").length;
    const inProg = events.length - completed;
    $("#archiveCurrentSummary").innerHTML = `
      <div>
        <div><strong>Current season</strong></div>
        <div class="ac-stats"><strong>${events.length}</strong> events · <strong>${completed}</strong> completed · <strong>${inProg}</strong> in progress</div>
      </div>
    `;
    const labelInput = $("#archiveLabel");
    if (labelInput && !labelInput.value) labelInput.placeholder = `Label this season — e.g. ${defaultArchiveLabel()}`;
    const btnArchive = $("#btnArchiveYear");
    if (btnArchive) btnArchive.disabled = events.length === 0;

    const list = $("#archiveList");
    const title = $("#archiveListTitle");
    if (school.archives.length === 0) {
      title.hidden = true;
      list.innerHTML = `<div class="archive-row empty">No archived seasons yet.</div>`;
      return;
    }
    title.hidden = false;
    const sorted = [...school.archives].sort((a,b) => b.archivedAt - a.archivedAt);
    list.innerHTML = sorted.map(a => {
      const date = new Date(a.archivedAt).toLocaleDateString(undefined, { year:"numeric", month:"short", day:"numeric" });
      const completedCount = (a.events||[]).filter(e => e.status === "completed").length;
      return `
        <div class="archive-row" data-id="${a.id}">
          <div>
            <div class="ar-label">${escapeHtml(a.label)}</div>
            <div class="ar-meta">Archived ${escapeHtml(date)} · ${(a.events||[]).length} events · ${completedCount} completed</div>
          </div>
          <div class="ar-actions">
            <button class="btn ghost" data-view-archive="${a.id}">View</button>
            <button class="btn" data-restore="${a.id}">Restore</button>
            <button class="btn danger ghost" data-delete="${a.id}">Delete</button>
          </div>
        </div>`;
    }).join("");
    list.querySelectorAll("[data-view-archive]").forEach(btn => btn.addEventListener("click", () => viewArchive(btn.dataset.viewArchive)));
    list.querySelectorAll("[data-restore]").forEach(btn => btn.addEventListener("click", () => restoreArchive(btn.dataset.restore)));
    list.querySelectorAll("[data-delete]").forEach(btn => btn.addEventListener("click", () => deleteArchive(btn.dataset.delete)));
  }

  /**
   * Read-only viewer for an archived season — reuses the Day Summary
   * markup but pulls events from the archive payload rather than live state.
   */
  function viewArchive(archiveId) {
    const archive = (state.school?.archives || []).find(a => a.id === archiveId);
    if (!archive) return;
    // Temporarily swap state.events with the archive snapshot to render the summary.
    const liveEvents = state.events;
    const liveQueue  = state.announceQueue;
    state.events        = archive.events || [];
    state.announceQueue = archive.announceQueue || [];
    const html = buildDaySummary();
    state.events        = liveEvents;
    state.announceQueue = liveQueue;

    $("#summaryBody").innerHTML = `
      <div style="background:#fef3c7;border:1px solid #facc15;color:#92400e;padding:10px 14px;border-radius:8px;margin-bottom:14px;font-weight:600">
        🔒 Viewing archived season "${escapeHtml(archive.label)}" — read-only
      </div>
    ` + html;
    $("#summaryModal").hidden = false;
  }
  async function archiveCurrentYear() {
    const events = state.events;
    if (events.length === 0) { showToast("Nothing to archive yet"); return; }
    const label = ($("#archiveLabel").value || "").trim() || defaultArchiveLabel();
    const completedCount = events.filter(e => e.status === "completed").length;
    if (!confirm(`Archive ${events.length} event${events.length===1?"":"s"} (${completedCount} completed) under "${label}"?\n\nYour Events, Admin, Ribbons, and Announcer screens will start fresh. You can restore this season any time.`)) return;
    try {
      await api.archiveSeason(label);
      await refreshState();
      $("#archiveLabel").value = "";
      renderSettings();
      updateAnnounceBadge();
      showToast(`Season "${label}" archived`);
    } catch (e) { showToast("Archive failed"); }
  }
  async function restoreArchive(archiveId) {
    const archive = (state.school?.archives||[]).find(a => a.id === archiveId);
    if (!archive) return;
    const liveCount = state.events.length;
    const merge = liveCount > 0;
    if (merge) {
      if (!confirm(`Restore "${archive.label}"?\n\nYou currently have ${liveCount} live event${liveCount===1?"":"s"}. Restoring will MERGE the archived season back in alongside them. Continue?`)) return;
    } else {
      if (!confirm(`Restore "${archive.label}"? This will bring back ${(archive.events||[]).length} archived event${(archive.events||[]).length===1?"":"s"}.`)) return;
    }
    try {
      await api.restoreArchive(archiveId);
      await refreshState();
      renderSettings();
      updateAnnounceBadge();
      showToast(`Restored "${archive.label}"`);
    } catch (e) { showToast("Restore failed"); }
  }
  async function deleteArchive(archiveId) {
    const archive = (state.school?.archives||[]).find(a => a.id === archiveId);
    if (!archive) return;
    if (!confirm(`Permanently delete the archived season "${archive.label}"?\n\nThis cannot be undone.`)) return;
    if (!confirm(`Are you sure? "${archive.label}" with ${(archive.events||[]).length} event${(archive.events||[]).length===1?"":"s"} will be lost forever.`)) return;
    try {
      await api.deleteArchive(archiveId);
      await refreshState();
      renderSettings();
      showToast("Archive deleted");
    } catch (e) { showToast("Delete failed"); }
  }

  // ---------- Backup (downloads a JSON snapshot of current school's data) ----------
  function exportData() {
    const blob = { school: state.school, events: state.events, announceQueue: state.announceQueue, exportedAt: new Date().toISOString() };
    const data = new Blob([JSON.stringify(blob, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(data);
    a.download = `${(state.school?.code || "fieldday")}-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  /**
   * "Snapshot Now" — one-click, timestamped CSV of every recorded result
   * across the whole day. Lets the admin prove what was on the books at
   * any moment ("at 11:47 AM we had 142 results recorded across 18 events")
   * and gives them a paper-trail file to keep alongside the live system.
   *
   * Format: one row per (event × competitor × attempt) with columns the
   * principal can scan in Excel without a manual.
   */
  function snapshotNow() {
    const events = state.events || [];
    const rows = [["Event","Age","Gender","Status","Leader","Competitor","Bib","House","Heat","Attempt#","Result","Unit","Place","Points","DQ","DQ Reason"]];
    const tieMethod = state.school?.tieMethod || "average";
    let resultCount = 0;
    for (const ev of events) {
      const placements = computePlacements(ev, tieMethod);
      for (const c of (ev.competitors || [])) {
        const place = placements.find(p => p.competitorId === c.id);
        const attempts = c.attempts || [];
        if (attempts.every(v => v == null || v === "")) {
          // Still emit a row for unfinished competitors so admin sees they exist.
          rows.push([ev.title, ev.age, ev.gender, ev.status, ev.leaderName||"", c.name||"", c.bib||"", c.house||"", c.heat||"", "", "", ev.unit||"", "", "", c.dq?"yes":"", c.dqReason||""]);
          continue;
        }
        attempts.forEach((v, i) => {
          if (v == null || v === "") return;
          resultCount++;
          rows.push([
            ev.title, ev.age, ev.gender, ev.status, ev.leaderName||"",
            c.name||"", c.bib||"", c.house||"", c.heat||"",
            (i+1), v, ev.unit||"",
            place?.place || "", place?.points ?? "",
            c.dq?"yes":"", c.dqReason||""
          ]);
        });
      }
    }
    // CSV-escape: wrap any cell containing comma/quote/newline in quotes, double internal quotes.
    const csv = rows.map(r => r.map(cell => {
      const s = String(cell == null ? "" : cell);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(",")).join("\n");
    const stamp = new Date();
    const stampPretty = stamp.toLocaleString();
    const fname = `${state.school?.code || "fieldday"}-snapshot-${stamp.toISOString().replace(/[:.]/g,"-").slice(0,19)}.csv`;
    const blob = new Blob([`# Field Day snapshot — ${stampPretty}\n# ${events.length} events · ${resultCount} recorded results · ${state.school?.name||""}\n${csv}`], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fname;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    showToast(`Snapshot saved · ${resultCount} results across ${events.length} events`);
  }
  async function resetAll() {
    if (!confirm("Sign out of this device? Your school's data stays in Curriculate; you can sign back in any time.")) return;
    try { await api.signOut(); } catch (e) {}
    api.clearSession();
    state = { school: null, events: [], announceQueue: [] };
    showWelcome();
    showToast("Signed out");
  }

  // ---------- Student Detail ----------
  function fmtTimeOfDay(ts) {
    if (!ts) return "—";
    const d = new Date(Number(ts));
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  function fmtDateTime(ts) {
    if (!ts) return "—";
    const d = new Date(Number(ts));
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  /**
   * Opens a modal showing every event a competitor (matched by name,
   * case-insensitive trim) has been entered into, with their result,
   * placement, points, time-of-day, and PB / record / DQ flags.
   *
   * Looks across ALL of state.events — for admin this is the whole school;
   * for leader it's whatever events they have visibility into.
   */
  function openStudentDetail(name) {
    const norm = (s) => (s || "").trim().toLowerCase();
    const target = norm(name);
    if (!target) return;
    const tie = state.school?.tieMethod || "average";
    const ageBands = state.school?.ageBands || [];

    const matches = [];   // { ev, c, placement, isRecord, beatPB }
    state.events.forEach(ev => {
      (ev.competitors||[]).forEach(c => {
        if (norm(c.name) !== target) return;
        const placements = computePlacements(ev, tie);
        const p = placements.find(x => x.competitorId === c.id) || {};
        const best = bestOfCompetitor(c, ev.type);
        const beatPB = didBeatPB(c, ev);
        const record = (state.school?.records || []).find(r =>
          (r.title||"").toLowerCase() === (ev.title||"").toLowerCase() &&
          String(r.age) === String(ev.age) && r.gender === ev.gender);
        const isCurrentRecordHolder = record && norm(record.holderName) === target;
        matches.push({ ev, c, placement: p, best, beatPB, isCurrentRecordHolder });
      });
    });

    if (matches.length === 0) { showToast(`No events found for ${name}`); return; }

    // Use the first match for kid metadata (DOB, grade, house, bib are per-row but
    // typically consistent for the same kid).
    const first = matches[0].c;
    const totalPoints = matches
      .filter(m => m.ev.format !== "team")
      .reduce((s, m) => s + (m.placement.points || 0), 0);
    const recordsHeld = matches.filter(m => m.isCurrentRecordHolder).length;
    const pbBeats = matches.filter(m => m.beatPB).length;

    const metaBits = [];
    if (first.bib)       metaBits.push(`#${escapeHtml(first.bib)}`);
    if (first.grade)     metaBits.push(`Grade ${escapeHtml(first.grade)}`);
    if (first.actualAge) metaBits.push(`Age ${escapeHtml(first.actualAge)}`);
    else if (matches[0].ev.age) metaBits.push(`Age ${escapeHtml(matches[0].ev.age)}`);
    if (first.house)     metaBits.push(`🏠 ${escapeHtml(first.house)}`);
    if (first.dob)       metaBits.push(`DOB ${escapeHtml(first.dob)}`);

    const placeClass = (p) => p == null ? "" : ["","gold","silver","bronze","fourth"][Math.min(4, Math.floor(p))] || "";

    const sorted = matches.slice().sort((a,b) => (a.ev.completedAt||a.ev.createdAt||0) - (b.ev.completedAt||b.ev.createdAt||0));
    const rows = sorted.map(m => {
      const tags = [];
      if (m.beatPB)              tags.push(`<span class="se-tag pb">🌟 PB</span>`);
      if (m.isCurrentRecordHolder) tags.push(`<span class="se-tag record">🏅 Record</span>`);
      if (m.c.dq)                tags.push(`<span class="se-tag dq">⊘ DQ</span>`);
      const ts = m.ev.completedAt || m.ev.updatedAt || m.ev.createdAt;
      return `
        <div class="student-event-row" data-event-id="${escapeHtml(m.ev.id)}">
          <div>
            <strong>${escapeHtml(m.ev.title)}</strong><br>
            <span class="muted small">Age ${escapeHtml(m.ev.age)} ${escapeHtml(m.ev.gender)}${m.ev.format === "team" ? " · Team" : ""}</span>
          </div>
          <div class="se-place ${placeClass(m.placement.place)}">
            ${m.placement.place == null ? (m.c.dq ? "DQ" : "—") : ordinal(m.placement.place)}
          </div>
          <div>${m.placement.points != null ? m.placement.points + " pt" : ""}</div>
          <div class="se-result">${fmtResult(m.best, m.ev.type, m.ev.unit)}</div>
          <div>
            <div class="se-time">${escapeHtml(fmtDateTime(ts))}</div>
            <div class="se-tags">${tags.join("")}</div>
          </div>
        </div>
      `;
    }).join("");

    $("#studentModalTitle").textContent = first.name;
    $("#studentModalBody").innerHTML = `
      <div class="student-detail-header">
        <h3>${escapeHtml(first.name)}</h3>
        <div class="student-detail-meta">${metaBits.join(" · ") || ""}</div>
      </div>
      <div class="student-detail-totals">
        <div class="total-card"><div class="total-num">${matches.length}</div><div class="total-lbl">events</div></div>
        <div class="total-card"><div class="total-num">${totalPoints}</div><div class="total-lbl">individual points</div></div>
        <div class="total-card"><div class="total-num">${pbBeats} / ${recordsHeld}</div><div class="total-lbl">PBs today / records held</div></div>
      </div>
      <h3 style="font-size:14px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin:18px 0 8px">Events</h3>
      <div class="student-event-list">${rows}</div>
      <p class="muted small" style="margin-top:14px">Click any row to open that event.</p>
    `;
    $("#studentModalBody").querySelectorAll(".student-event-row").forEach(r => {
      r.addEventListener("click", () => {
        const id = r.dataset.eventId;
        $("#studentModal").hidden = true;
        if (id) openEventDetail(id);
      });
    });
    $("#studentModal").hidden = false;
  }

  // ---------- Day Summary ----------
  function buildDaySummary() {
    const school = state.school;
    const events = state.events;
    const tie = school?.tieMethod || "average";
    const all = computeAllPersonTotals(events, tie);

    const podium = (rows, n=3) => rows.length === 0
      ? `<tr><td colspan="2" class="muted">—</td></tr>`
      : rows.slice(0, n).map((r, i) => `
          <tr><td><span data-student-name="${escapeHtml(r.name)}">${["🥇","🥈","🥉"][i]||""} ${escapeHtml(r.name)}</span></td><td class="pts">${r.points}</td></tr>`).join("");

    let html = `
      <div class="summary-section">
        <h3>${escapeHtml(school?.name || "Field Day")} — ${new Date().toLocaleDateString()}</h3>
        <p class="muted small">${events.filter(e=>e.status==="completed").length} of ${events.length} events completed.</p>
      </div>

      <div class="summary-section">
        <h3>Top 3 Overall</h3>
        <table><tbody>${podium(all)}</tbody></table>
      </div>

      <div class="summary-section">
        <h3>Top 3 by Gender</h3>
        <table><tbody>
          ${["Girls","Boys","Mixed"].map(g => {
            const r = all.filter(x => x.gender === g);
            if (r.length === 0) return "";
            return `<tr><td colspan="2"><strong>${g}</strong></td></tr>${podium(r)}`;
          }).join("")}
        </tbody></table>
      </div>

      <div class="summary-section">
        <h3>Top 3 by Age Band</h3>
        <table><tbody>
          ${(school?.ageBands||[]).map(band => {
            const ages = parseBand(band);
            const r = all.filter(x => [...x.ages].some(a => ageInBand(a, ages)));
            if (r.length === 0) return "";
            return `<tr><td colspan="2"><strong>${escapeHtml(band)}</strong></td></tr>${podium(r)}`;
          }).join("")}
        </tbody></table>
      </div>`;

    if ((school?.houses||[]).length > 0) {
      const houseTotals = new Map((school.houses||[]).map(h => [h, 0]));
      events.forEach(ev => {
        const placements = computePlacements(ev, tie);
        placements.forEach(p => {
          const c = (ev.competitors||[]).find(c => c.id === p.competitorId);
          if (!c?.house || !houseTotals.has(c.house)) return;
          houseTotals.set(c.house, houseTotals.get(c.house) + (p.points||0));
        });
      });
      const ranked = [...houseTotals.entries()].sort((a,b) => b[1] - a[1]);
      html += `
        <div class="summary-section">
          <h3>House Standings</h3>
          <table><tbody>
            ${ranked.map(([name, pts], i) => `
              <tr><td>${i===0?"👑 ":""}${escapeHtml(name)}</td><td class="pts">${Math.round(pts*100)/100}</td></tr>`).join("")}
          </tbody></table>
        </div>`;
    }

    // Records
    const records = school?.records || [];
    if (records.length > 0) {
      html += `
        <div class="summary-section">
          <h3>School Records (current)</h3>
          <table><thead><tr><th>Event</th><th>Age/Gender</th><th>Holder</th><th>Result</th><th>Set</th></tr></thead><tbody>
            ${[...records].sort((a,b)=>(b.dateSet||"").localeCompare(a.dateSet||"")).map(r => `
              <tr>
                <td>${escapeHtml(r.title||"")}</td>
                <td>${escapeHtml(r.age||"")} ${escapeHtml(r.gender||"")}</td>
                <td>${escapeHtml(r.holderName||"")}</td>
                <td>${fmtResult(r.value, r.type, r.unit)}</td>
                <td>${escapeHtml(r.dateSet||"")}</td>
              </tr>`).join("")}
          </tbody></table>
        </div>`;
    }

    // Discover Curriculate — gentle cross-promo at the end of the day
    html += `
      <div class="summary-section" style="background:linear-gradient(180deg,#e7eeff,transparent);border-radius:var(--radius);padding:18px 20px;margin-top:24px">
        <h3 style="color:var(--primary)">Loved Field Day? Try Curriculate for the rest of the year.</h3>
        <p>Field Day is one corner of <strong>Curriculate</strong> — the grading platform for teachers who'd rather spend their evenings with their families. AI-assisted feedback on student work, batch grading, parent reports, all in one place.</p>
        <p style="margin-top:10px"><a href="https://www.curriculate.net" target="_blank" rel="noopener" style="display:inline-block;background:var(--primary);color:white;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">See Curriculate →</a></p>
      </div>

      <div class="summary-section">
        <h3>Event Results</h3>
        ${events.filter(e => e.status==="completed").sort((a,b) =>
          (a.age||"").localeCompare(b.age||"") || (a.gender||"").localeCompare(b.gender||"") || (a.title||"").localeCompare(b.title||""))
          .map(ev => {
            const placements = computePlacements(ev, tie).filter(p => p.place != null).sort((a,b) => a.place - b.place);
            if (placements.length === 0) return "";
            return `
              <div style="margin-bottom:12px">
                <div style="font-weight:700">${escapeHtml(ev.title)} — Age ${escapeHtml(ev.age)} ${escapeHtml(ev.gender)}</div>
                <table><tbody>${placements.slice(0,4).map(p => {
                  const c = (ev.competitors||[]).find(c => c.id === p.competitorId);
                  return `<tr><td>${ordinal(p.place)} ${escapeHtml(c?.name||"")}</td><td class="pts">${fmtResult(bestOf(c?.attempts, ev.type), ev.type, ev.unit)}</td></tr>`;
                }).join("")}</tbody></table>
              </div>`;
          }).join("")}
      </div>`;

    return html;
  }
  function openDaySummary() {
    $("#summaryBody").innerHTML = buildDaySummary();
    $("#summaryModal").hidden = false;
  }

  // ===========================================================
  // Workbook (.xlsx) import / download
  //
  // SheetJS (~600KB) is lazy-loaded the first time an admin asks for
  // Excel functionality, so the initial page load stays light on bad
  // Wi-Fi. The promise is cached, so subsequent calls are instant.
  // ===========================================================
  let _xlsxLoadPromise = null;
  function loadSheetJS() {
    if (typeof XLSX !== "undefined") return Promise.resolve(window.XLSX);
    if (_xlsxLoadPromise) return _xlsxLoadPromise;
    _xlsxLoadPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      // CDN with a self-host fallback. Adjust URLs if you bundle locally.
      s.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
      s.async = true;
      s.onload  = () => resolve(window.XLSX);
      s.onerror = () => {
        // Fallback: try same-origin copy at /fieldday/vendor/xlsx.full.min.js
        const s2 = document.createElement("script");
        s2.src = "/fieldday/vendor/xlsx.full.min.js";
        s2.async = true;
        s2.onload = () => resolve(window.XLSX);
        s2.onerror = () => reject(new Error("Couldn't load Excel library"));
        document.head.appendChild(s2);
      };
      document.head.appendChild(s);
    });
    return _xlsxLoadPromise;
  }

  /** Wraps a button in a "Loading…" state while SheetJS loads. */
  async function withSheetJS(btnId, work) {
    const btn = $("#" + btnId);
    const orig = btn?.textContent;
    if (btn) { btn.disabled = true; btn.textContent = "Loading Excel…"; }
    try {
      await loadSheetJS();
      await work();
    } catch (e) {
      showToast("Couldn't load Excel library — check your connection");
      console.warn(e);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = orig; }
    }
  }

  async function openWorkbookModal() {
    await withSheetJS("btnImportWorkbook", async () => {
      $("#workbookFile").value = "";
      $("#workbookFileName").textContent = "No file chosen";
      $("#workbookLog").innerHTML = "";
      $("#workbookLog").hidden = true;
      $("#workbookModal").hidden = false;
    });
  }

  async function handleWorkbookFile(file) {
    if (!file) return;
    $("#workbookFileName").textContent = file.name;
    const log = $("#workbookLog"); log.hidden = false; log.innerHTML = "";
    const append = (cls, msg) => { log.innerHTML += `<div class="${cls}">${msg}</div>`; log.scrollTop = log.scrollHeight; };
    try { await loadSheetJS(); }
    catch (e) { append("err", "✗ Couldn't load Excel library — check your connection"); return; }
    let buf;
    try { buf = await file.arrayBuffer(); }
    catch (e) { append("err", "✗ Couldn't read file"); return; }
    let wb;
    try { wb = XLSX.read(buf, { type: "array" }); }
    catch (e) { append("err", "✗ Not a valid Excel workbook"); return; }

    const mode = document.querySelector("input[name='wbMode']:checked")?.value || "merge";
    if (mode === "replace") {
      if (!confirm("REPLACE will delete every event + competitor for this school first. Continue?")) {
        append("err", "Cancelled."); return;
      }
    }

    // Snapshot the current state before any destructive operation
    try {
      append("ok", "📦 Creating safety backup before import…");
      await api.createBackup("pre-import");
    } catch (e) { /* non-fatal */ }

    if (mode === "replace") {
      append("ok", "🗑 Replace mode: deleting current events…");
      const myEvents = state.events.slice();
      for (const ev of myEvents) {
        try { await api.deleteEvent(ev.id); } catch (e) { /* keep going */ }
      }
      state.events = []; state.announceQueue = [];
    }

    const tabs = {};
    wb.SheetNames.forEach(n => { tabs[n.toLowerCase().trim()] = wb.Sheets[n]; });
    const sheetToRows = (sheet) => sheet ? XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false }) : [];

    // Order matters: divisions / houses / events first (they configure the school),
    // then standards / records / PBs, then roster (which references the above).
    const importers = [
      { tab: "divisions", label: "Divisions", run: importDivisionsTab },
      { tab: "houses",    label: "Houses",    run: importHousesTab    },
      { tab: "events",    label: "Events",    run: importEventsTab    },
      { tab: "staff",     label: "Staff",     run: importStaffTab     },
      { tab: "rules",     label: "Rules",     run: importRulesTab     },
      { tab: "standards", label: "Standards", run: importStandardsTab },
      { tab: "records",   label: "Records",   run: importRecordsTab   },
      { tab: "pbs",       label: "PBs",       run: importPBsTab       },
      { tab: "roster",    label: "Roster",    run: importRosterTab    }
    ];

    for (const i of importers) {
      const sheet = tabs[i.tab];
      if (!sheet) continue;
      const rows = sheetToRows(sheet);
      if (rows.length === 0) continue;
      try {
        const summary = await i.run(rows, append);
        append("ok", `✓ ${i.label}: ${summary || "imported"}`);
      } catch (e) {
        append("err", `✗ ${i.label}: ${e.message || e}`);
      }
    }

    await refreshState();
    renderAdmin();
    append("ok", `<br/><strong>Done.</strong>`);
  }

  // ---- Tab parsers ----------------------------------------------------------
  function rowsToHeaderObjects(rows) {
    const header = (rows[0]||[]).map(h => String(h||"").trim());
    return rows.slice(1).filter(r => r.some(v => String(v||"").trim() !== "")).map(r => {
      const obj = {};
      header.forEach((h, i) => { obj[h.toLowerCase()] = String(r[i] ?? "").trim(); });
      return obj;
    });
  }

  async function importDivisionsTab(rows) {
    const items = rowsToHeaderObjects(rows);
    const list = items.map(o => ({
      name: o.name || o.division || "",
      ageRange: [parseInt(o.minage||o["min age"]||o.lo||"0",10), parseInt(o.maxage||o["max age"]||o.hi||"0",10)]
    })).filter(d => d.name);
    if (list.length === 0) return "no rows";
    const resp = await api.updateSchool({ divisions: list });
    if (resp?.school) state.school = resp.school;
    return `${list.length} division(s)`;
  }
  async function importHousesTab(rows) {
    const items = rowsToHeaderObjects(rows);
    const list = items.map(o => o.house || o.name || "").filter(Boolean);
    if (list.length === 0) return "no rows";
    const resp = await api.updateSchool({ houses: list });
    if (resp?.school) state.school = resp.school;
    return `${list.length} house(s)`;
  }
  async function importEventsTab(rows) {
    const items = rowsToHeaderObjects(rows);
    const lib = []; const defaults = {}; const rules = state.school?.eventRules || {};
    items.forEach(o => {
      const title = o.title || o.event || "";
      if (!title) return;
      lib.push(title);
      defaults[title] = {
        type: (o.type || "timed").toLowerCase(),
        attempts: parseInt(o.attempts || "1", 10) || 1,
        unit: (o.unit || "").trim()
      };
      if (o.rules) {
        const existing = rules[title];
        if (existing && typeof existing === "object") existing.base = o.rules;
        else rules[title] = { base: o.rules, byDivision: {} };
      }
    });
    const resp = await api.updateSchool({ eventLibrary: lib, eventDefaults: defaults, eventRules: rules });
    if (resp?.school) state.school = resp.school;
    return `${lib.length} event(s)`;
  }
  async function importStaffTab(rows) {
    const items = rowsToHeaderObjects(rows);
    const staff = state.school?.eventStaff || {};
    items.forEach(o => {
      const title = o.title || o.event || "";
      if (!title) return;
      if (!staff[title]) staff[title] = {};
      Object.entries(o).forEach(([k, v]) => {
        if (k === "title" || k === "event" || !v) return;
        // Header is "Junior Leader" — split off division (first word) + role (rest)
        const parts = k.split(/\s+/);
        if (parts.length < 2) return;
        const division = parts[0].replace(/\b\w/g, c => c.toUpperCase());
        const role     = parts.slice(1).join(" ").replace(/\b\w/g, c => c.toUpperCase());
        if (!staff[title][division]) staff[title][division] = {};
        staff[title][division][role] = v;
      });
    });
    const resp = await api.updateSchool({ eventStaff: staff });
    if (resp?.school) state.school = resp.school;
    return `${items.length} event-staff row(s)`;
  }
  async function importRulesTab(rows) {
    const items = rowsToHeaderObjects(rows);
    const rules = state.school?.eventRules || {};
    items.forEach(o => {
      const title = o.event || o.title || "";
      const division = o.division || "";
      const text = o.rules || "";
      if (!title || !division || !text) return;
      const cur = rules[title];
      if (typeof cur === "string") rules[title] = { base: cur, byDivision: {} };
      else if (!cur) rules[title] = { base: "", byDivision: {} };
      rules[title].byDivision[division] = text;
    });
    const resp = await api.updateSchool({ eventRules: rules });
    if (resp?.school) state.school = resp.school;
    return `${items.length} override(s)`;
  }
  async function importStandardsTab(rows) {
    const items = rowsToHeaderObjects(rows);
    const existing = state.school?.standards || [];
    let added = 0, updated = 0;
    for (const o of items) {
      const title = o.event || o.title || "";
      const ageBand = o.ageband || o["age band"] || "";
      const gender = (o.gender||"").trim();
      if (!title || !ageBand || !gender) continue;
      const gold   = parseFloat(o.gold);
      const silver = parseFloat(o.silver);
      const bronze = parseFloat(o.bronze);
      if ([gold,silver,bronze].some(isNaN)) continue;
      const match = existing.find(s => s.title === title && s.ageBand === ageBand && s.gender === gender);
      const payload = { title, ageBand, gender, gold, silver, bronze, type: o.type || (match?.type||"timed"), unit: o.unit || (match?.unit||"") };
      if (match) { await api.updateStandard(match.id, payload); updated++; }
      else       { await api.createStandard(payload);            added++; }
    }
    return `${added} added, ${updated} updated`;
  }
  async function importRecordsTab(rows) {
    const items = rowsToHeaderObjects(rows);
    let n = 0;
    for (const o of items) {
      const title = o.event || o.title || "";
      const age = o.age || ""; const gender = o.gender || "";
      const value = parseFloat(o.result || o.value);
      if (!title || !age || !gender || isNaN(value)) continue;
      await api.createRecord({
        title, age, gender, value,
        type: o.type || "timed", unit: o.unit || "",
        holderName: o.holder || o["holder name"] || "",
        dateSet: o.dateset || o["date set"] || ""
      });
      n++;
    }
    return `${n} record(s)`;
  }
  async function importPBsTab(rows) {
    const items = rowsToHeaderObjects(rows);
    let n = 0;
    for (const o of items) {
      const name = o.name || ""; const title = o.event || ""; const value = parseFloat(o.result || o.value);
      if (!name || !title || isNaN(value)) continue;
      // Find an existing event with this title to derive type/gender/unit
      const ev = state.events.find(e => (e.title||"").toLowerCase() === title.toLowerCase());
      await savePersonalBest({
        name, title,
        gender: ev?.gender || "Mixed",
        value, type: ev?.type || "timed", unit: ev?.unit || ""
      });
      n++;
    }
    return `${n} PB(s)`;
  }
  async function importRosterTab(rows, append) {
    if (rows.length < 2) return "no rows";
    const header = rows[0].map(h => String(h||"").trim());
    const headerLow = header.map(h => h.toLowerCase());
    const find = (...names) => {
      for (const n of names) { const i = headerLow.indexOf(n.toLowerCase()); if (i >= 0) return i; }
      return -1;
    };
    const iName     = find("name", "competitor");
    const iGender   = find("gender");
    const iDOB      = find("dob", "date of birth");
    const iAge      = find("age", "actualage", "actual age");
    const iGrade    = find("grade");
    const iHouse    = find("house");
    const iBib      = find("bib", "race number", "race #", "number");
    const iActual   = find("actualage", "actual age");
    if (iName < 0 || iGender < 0 || (iDOB < 0 && iAge < 0)) {
      throw new Error("Roster needs Name, Gender, and DOB or Age columns");
    }
    // Event columns are anything else
    const reservedLow = new Set(["name","gender","dob","date of birth","age","actualage","actual age","grade","house","notes","members","bib","race number","race #","number"]);
    const eventCols = header.map((h, i) => ({ h, i })).filter(({h}) => !reservedLow.has(h.toLowerCase()));

    let kids = 0, entries = 0, eventsCreated = 0;
    for (const r of rows.slice(1)) {
      const name   = String(r[iName]||"").trim();
      if (!name) continue;
      const gender = String(r[iGender]||"").trim();
      const dob    = iDOB    >= 0 ? String(r[iDOB]||"").trim()  : "";
      const ageRaw = iAge    >= 0 ? String(r[iAge]||"").trim()  : "";
      const grade  = iGrade  >= 0 ? String(r[iGrade]||"").trim() : "";
      const house  = iHouse  >= 0 ? String(r[iHouse]||"").trim() : "";
      const bib    = iBib    >= 0 ? String(r[iBib]  ||"").trim() : "";
      let actualAge = iActual >= 0 ? String(r[iActual]||"").trim() : "";
      let computedAge = "";
      if (dob) {
        const a = computeAge(dob, state.school?.ageCutoffDate);
        if (a != null) computedAge = String(a);
      }
      const eventTier = ageRaw || computedAge;
      if (!actualAge) actualAge = computedAge || ageRaw;
      if (!eventTier) { append("err", `✗ Skipped ${name}: no Age or DOB`); continue; }
      kids++;

      for (const ec of eventCols) {
        const cell = String(r[ec.i]||"").trim();
        if (!cell) continue;
        const heat = /^(y|yes|true|x|✓)$/i.test(cell) ? "" : cell;
        const eventTitle = ec.h;
        // Find or create event
        let ev = state.events.find(e =>
          (e.title||"").toLowerCase() === eventTitle.toLowerCase() &&
          String(e.age) === String(eventTier) && e.gender === gender);
        if (!ev) {
          const d = defaultsForTitle(eventTitle);
          const session = api.getSession();
          const resp = await api.createEvent({
            title: eventTitle, age: eventTier, gender,
            type: d.type, attempts: d.attempts, unit: d.unit, notes: "",
            leaderName: session?.leaderName || session?.email || "Admin",
            competitors: []
          });
          ev = resp?.event;
          if (ev) { applyEntityUpdate(resp); eventsCreated++; }
          else continue;
        }
        // Dedupe: skip if a competitor with the same name (case-insensitive) is already in this event
        const evLive = state.events.find(e => e.id === ev.id);
        const dup = (evLive?.competitors || []).find(c => (c.name||"").trim().toLowerCase() === name.trim().toLowerCase());
        if (dup) {
          // Update the existing competitor's metadata if the row provides new info
          const patch = {};
          if (grade && !dup.grade) patch.grade = grade;
          if (actualAge && !dup.actualAge) patch.actualAge = actualAge;
          if (dob && !dup.dob) patch.dob = dob;
          if (heat && !dup.heat) patch.heat = heat;
          if (house && !dup.house) patch.house = house;
          if (Object.keys(patch).length > 0) {
            try {
              const u = await api.updateCompetitor(ev.id, dup.id, patch);
              if (u?.competitor) Object.assign(dup, u.competitor);
            } catch (e) {}
          }
          entries++;
          continue;
        }
        // Add competitor
        const r2 = await api.addCompetitor(ev.id, name);
        const created = r2?.competitor;
        if (!created) continue;
        const patch = {};
        if (grade) patch.grade = grade;
        if (actualAge) patch.actualAge = actualAge;
        if (dob) patch.dob = dob;
        if (heat) patch.heat = heat;
        if (house) patch.house = house;
        if (bib) patch.bib = bib;
        if (Object.keys(patch).length > 0) {
          const u = await api.updateCompetitor(ev.id, created.id, patch);
          const local = state.events.find(e => e.id === ev.id)?.competitors.find(x => x.id === created.id);
          if (local && u?.competitor) Object.assign(local, u.competitor);
        } else {
          const local = state.events.find(e => e.id === ev.id);
          if (local) local.competitors.push(created);
        }
        entries++;
      }
    }
    return `${kids} kid(s), ${entries} entries, ${eventsCreated} event(s) created`;
  }

  // ---- Workbook download (pre-populated) -----------------------------------
  function downloadWorkbook() {
    return withSheetJS("btnDownloadWorkbook", () => _doDownloadWorkbook());
  }
  function _doDownloadWorkbook() {
    const school = state.school; if (!school) return;
    const wb = XLSX.utils.book_new();

    // ----- Roster (wide) -----
    const events = state.events;
    const eventTitles = [...new Set(events.map(e => e.title))];
    // Each kid (by name) gets one row, with Y/heat per event
    const kidMap = new Map();
    events.forEach(ev => {
      (ev.competitors||[]).forEach(c => {
        const key = (c.name||"").trim().toLowerCase();
        if (!key) return;
        let entry = kidMap.get(key);
        if (!entry) {
          entry = { name: c.name, gender: ev.gender, dob: c.dob||"", age: c.actualAge || ev.age, grade: c.grade||"", house: c.house||"", bib: c.bib||"", perEvent: {} };
          kidMap.set(key, entry);
        }
        entry.perEvent[ev.title] = c.heat || "Y";
      });
    });
    const rosterHeader = ["Name","Gender","DOB","Age","Grade","House","Bib", ...eventTitles];
    const rosterRows = [...kidMap.values()].map(k => [
      k.name, k.gender, k.dob, k.age, k.grade, k.house, k.bib,
      ...eventTitles.map(t => k.perEvent[t] || "")
    ]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([rosterHeader, ...rosterRows]), "Roster");

    // ----- Events -----
    const evRows = (school.eventLibrary||[]).map(title => {
      const d = (school.eventDefaults||{})[title] || {};
      const inferred = inferEventType(title);
      const rule = (school.eventRules||{})[title];
      const ruleBase = typeof rule === "string" ? rule : (rule?.base || "");
      return [title, d.type || inferred.type, d.attempts != null ? d.attempts : inferred.attempts, d.unit || inferred.unit, "", "event", ruleBase];
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ["Title","Type","Attempts","Unit","Format","ScoreBy","Rules"], ...evRows
    ]), "Events");

    // ----- Staff -----
    const divs = (school.divisions||[]);
    const roleNames = ["Leader","Assistant"];
    const staff = school.eventStaff || {};
    const staffHeader = ["Title", ...divs.flatMap(d => roleNames.map(r => `${d.name} ${r}`))];
    const staffRows = (school.eventLibrary||[]).map(title => {
      const row = [title];
      for (const d of divs) for (const r of roleNames) row.push((staff[title]?.[d.name]?.[r])||"");
      return row;
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([staffHeader, ...staffRows]), "Staff");

    // ----- Rules (per-division overrides) -----
    const rulesRows = [];
    Object.entries(school.eventRules||{}).forEach(([title, entry]) => {
      if (typeof entry !== "object" || !entry?.byDivision) return;
      Object.entries(entry.byDivision).forEach(([division, text]) => {
        if (text) rulesRows.push([title, division, text]);
      });
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ["Event","Division","Rules"], ...rulesRows
    ]), "Rules");

    // ----- Standards / Records / PBs -----
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ["Event","AgeBand","Gender","Type","Unit","Gold","Silver","Bronze"],
      ...((school.standards||[]).map(s => [s.title, s.ageBand, s.gender, s.type||"", s.unit||"", s.gold, s.silver, s.bronze]))
    ]), "Standards");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ["Event","Age","Gender","Type","Unit","Result","Holder","DateSet"],
      ...((school.records||[]).map(r => [r.title, r.age, r.gender, r.type||"", r.unit||"", r.value, r.holderName||"", r.dateSet||""]))
    ]), "Records");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ["Name","Event","Gender","Result","Type","Unit","DateSet"],
      ...((school.personalBests||[]).map(p => [p.name, p.title, p.gender, p.value, p.type||"", p.unit||"", p.dateSet||""]))
    ]), "PBs");

    // ----- Houses / Divisions -----
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ["House"], ...((school.houses||[]).map(h => [h]))
    ]), "Houses");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ["Name","MinAge","MaxAge"], ...((school.divisions||[]).map(d => [d.name, (d.ageRange||[])[0]||"", (d.ageRange||[])[1]||""]))
    ]), "Divisions");

    XLSX.writeFile(wb, `${(school.code||"fieldday")}-workbook-${new Date().toISOString().slice(0,10)}.xlsx`);
  }

  // ---------- Roster CSV Import ----------
  /** Minimal RFC-4180-ish CSV parser. Returns an array of arrays of strings. */
  function parseCSV(text) {
    const rows = [];
    let row = [], cur = "", inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"' && text[i+1] === '"') { cur += '"'; i++; }
        else if (ch === '"') { inQuotes = false; }
        else { cur += ch; }
      } else {
        if (ch === '"') { inQuotes = true; }
        else if (ch === ",") { row.push(cur); cur = ""; }
        else if (ch === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
        else if (ch === "\r") { /* skip */ }
        else { cur += ch; }
      }
    }
    if (cur.length || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(r => r.length > 0 && !(r.length === 1 && r[0].trim() === ""));
  }

  function inferEventType(title) {
    const t = (title||"").toLowerCase();
    if (/(jump|throw|put|distance|toss)/.test(t)) return { type: "distance", attempts: 3, unit: "m" };
    if (/(sprint|run|race|hurdle|relay|course|tug)/.test(t)) return { type: "timed", attempts: 1, unit: "seconds" };
    return { type: "timed", attempts: 1, unit: "" };
  }

  let importParsedRows = null;     // rows ready to apply
  let importPlan = null;           // {events:[…], errors:[…]} from preview

  function downloadImportTemplate() {
    const lib = state.school?.eventLibrary || ["50m Sprint","Long Jump","Shot Put"];
    const sampleEvents = lib.slice(0, 3);
    const houses = (state.school?.houses||[]);
    const h0 = houses[0] || "Alpha";
    const h1 = houses[1] || "Beta";
    // Columns grouped: Identity → Slot → Roster → Race day → Team
    const headers = "Name,Event,Age,Gender,DOB,Grade,House,Heat,Bib,PersonalBest,ActualAge,Notes,Members";
    const rows = [
      // Same kid in three events — DOB/Grade/House only on first row, inherited downward
      `Maya Patel,${sampleEvents[0]},8,Girls,2017-04-12,3,${h0},1,42,8.65,,,`,
      `Maya Patel,${sampleEvents[1] || sampleEvents[0]},8,Girls,,,,A,42,3.10,,wears glasses,`,
      `Maya Patel,${sampleEvents[2] || sampleEvents[0]},9,Girls,,,,B,42,,,running up,`,
      `Sofia Martinez,${sampleEvents[0]},9,Girls,2017-11-02,4,${h1},1,43,9.40,,,`,
      `Liam Cole,${sampleEvents[1] || sampleEvents[0]},10,Boys,2015-06-19,5,${h0},A,44,2.80,,,`,
      // A team / relay row — Name is the team name, Members lists runners
      `${h0} Relay Team,4x50m Relay,10,Mixed,,,${h0},,,,,,Maya Patel; Liam Cole; Ava Chen; Noah Reyes`
    ];
    const csv = [headers, ...rows].join("\n") + "\n";
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "fieldday-roster-template.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function openImportModal() {
    importParsedRows = null;
    importPlan = null;
    $("#importFile").value = "";
    $("#importPaste").value = "";
    $("#importFileName").textContent = "No file chosen";
    $("#importPreview").hidden = true;
    $("#importLog").hidden = true;
    $("#btnImportApply").disabled = true;
    $("#importModal").hidden = false;
  }

  function previewImport() {
    const text = $("#importPaste").value.trim();
    if (!text) { showToast("Choose a CSV file or paste CSV text first"); return; }
    const rows = parseCSV(text);
    if (rows.length < 2) { showToast("CSV must have a header row and at least one data row"); return; }

    // Header mapping (case-insensitive)
    const header = rows[0].map(h => h.trim().toLowerCase());
    const colIdx = (name, alts=[]) => {
      const all = [name, ...alts].map(s => s.toLowerCase());
      for (let i = 0; i < header.length; i++) if (all.includes(header[i])) return i;
      return -1;
    };
    const iEvent  = colIdx("event", ["event title","title"]);
    const iAge    = colIdx("age");
    const iGender = colIdx("gender");
    const iName   = colIdx("name", ["competitor","competitor name","student"]);
    const iGrade  = colIdx("grade");
    const iActual = colIdx("actualage", ["actual age","real age","home age"]);
    const iDob    = colIdx("dob", ["date of birth","birthdate","birthday"]);
    const iHeat   = colIdx("heat", ["heat number","heat #"]);
    const iHouse  = colIdx("house", ["team","house team"]);
    const iPB     = colIdx("personalbest", ["personal best","pb"]);
    const iBib    = colIdx("bib", ["race number","race #","number"]);

    const required = { Event: iEvent, Age: iAge, Gender: iGender, Name: iName };
    const missing = Object.entries(required).filter(([_, idx]) => idx < 0).map(([k]) => k);
    if (missing.length > 0) { showToast(`Missing column(s): ${missing.join(", ")}`); return; }

    // Group rows by (event title, age, gender) so we know which events to create/find
    const groups = new Map();
    const errors = [];
    rows.slice(1).forEach((r, ri) => {
      const lineNo = ri + 2;
      const eventTitle = (r[iEvent]||"").trim();
      const age = (r[iAge]||"").trim();
      const gender = (r[iGender]||"").trim();
      const name = (r[iName]||"").trim();
      const grade = iGrade  >= 0 ? (r[iGrade] ||"").trim() : "";
      let actualAge = iActual >= 0 ? (r[iActual]||"").trim() : "";
      const dob   = iDob    >= 0 ? (r[iDob]  ||"").trim() : "";
      const heat  = iHeat   >= 0 ? (r[iHeat] ||"").trim() : "";
      const house = iHouse  >= 0 ? (r[iHouse]||"").trim() : "";
      const pb    = iPB     >= 0 ? parseFloat(r[iPB]) : NaN;
      const bib   = iBib    >= 0 ? (r[iBib]  ||"").trim() : "";
      // If DOB is provided and no explicit ActualAge, compute from DOB + cutoff
      if (dob && !actualAge) {
        const computed = computeAge(dob, state.school?.ageCutoffDate);
        if (computed != null) actualAge = String(computed);
      }
      if (!eventTitle || !age || !gender || !name) {
        errors.push({ lineNo, msg: "Missing required field", row: r.join(",") });
        return;
      }
      const validGender = ["girls","boys","mixed"].includes(gender.toLowerCase());
      if (!validGender) {
        errors.push({ lineNo, msg: `Gender must be Girls/Boys/Mixed, got "${gender}"`, row: r.join(",") });
        return;
      }
      const genderTitled = gender[0].toUpperCase() + gender.slice(1).toLowerCase();
      const key = `${eventTitle}||${age}||${genderTitled}`;
      if (!groups.has(key)) groups.set(key, { eventTitle, age, gender: genderTitled, competitors: [] });
      groups.get(key).competitors.push({ name, grade, actualAge, dob, heat, house, pb, bib, eventTitle, gender: genderTitled, age, lineNo });
    });

    // Match against existing events; flag those that need creating
    const plan = { groups: [], errors, totalCompetitors: 0 };
    groups.forEach(g => {
      const existing = state.events.find(e =>
        (e.title||"").toLowerCase() === g.eventTitle.toLowerCase() &&
        String(e.age) === String(g.age) &&
        e.gender === g.gender);
      g.existingEvent = existing;
      g.willCreate = !existing;
      plan.totalCompetitors += g.competitors.length;
      plan.groups.push(g);
    });
    importPlan = plan;

    // Render preview
    const newCount = plan.groups.filter(g => g.willCreate).length;
    const existCount = plan.groups.filter(g => !g.willCreate).length;
    let html = `
      <div class="import-preview-summary">
        ${plan.totalCompetitors} competitors across ${plan.groups.length} events
        (${newCount} new, ${existCount} existing)
        ${errors.length ? ` · ${errors.length} row(s) with errors` : ""}
      </div>
      <table>
        <thead><tr><th>Event</th><th>Age</th><th>Gender</th><th>Status</th><th>Competitors</th></tr></thead>
        <tbody>
          ${plan.groups.map(g => `
            <tr class="${g.willCreate?"new-event":""}">
              <td>${escapeHtml(g.eventTitle)}</td>
              <td>${escapeHtml(g.age)}</td>
              <td>${escapeHtml(g.gender)}</td>
              <td>${g.willCreate ? "✚ create" : "→ existing"}</td>
              <td>${g.competitors.map(c => escapeHtml(c.name) + (c.grade?` <span class="muted small">(G${escapeHtml(c.grade)})</span>`:"") + (c.actualAge && c.actualAge !== g.age ? ` <span class="muted small">[age ${escapeHtml(c.actualAge)}]</span>`:"")).join(", ")}</td>
            </tr>`).join("")}
          ${errors.map(e => `
            <tr class="error">
              <td colspan="5">Line ${e.lineNo}: ${escapeHtml(e.msg)} — <code>${escapeHtml(e.row)}</code></td>
            </tr>`).join("")}
        </tbody>
      </table>`;
    $("#importPreview").innerHTML = html;
    $("#importPreview").hidden = false;
    $("#btnImportApply").disabled = plan.groups.length === 0;
  }

  async function applyImport() {
    if (!importPlan) { showToast("Click Preview first"); return; }
    const log = $("#importLog");
    log.hidden = false;
    log.innerHTML = "";
    const append = (cls, msg) => { log.innerHTML += `<div class="${cls}">${msg}</div>`; log.scrollTop = log.scrollHeight; };

    let createdEvents = 0, addedCompetitors = 0, failed = 0;
    $("#btnImportApply").disabled = true;
    $("#btnImportCancel").disabled = true;

    for (const g of importPlan.groups) {
      let event = g.existingEvent;
      if (!event) {
        const inferred = inferEventType(g.eventTitle);
        try {
          const session = api.getSession();
          const resp = await api.createEvent({
            title: g.eventTitle, age: g.age, gender: g.gender,
            type: inferred.type, attempts: inferred.attempts, unit: inferred.unit, notes: "",
            leaderName: session?.leaderName || session?.email || "Admin",
            competitors: []
          });
          event = resp?.event;
          if (event) {
            applyEntityUpdate(resp);
            createdEvents++;
            append("ok", `✚ Created event: ${escapeHtml(g.eventTitle)} (Age ${escapeHtml(g.age)} ${escapeHtml(g.gender)})`);
          }
        } catch (e) {
          append("err", `✗ Failed to create event ${escapeHtml(g.eventTitle)} (Age ${escapeHtml(g.age)} ${escapeHtml(g.gender)})`);
          failed++;
          continue;
        }
      }
      for (const c of g.competitors) {
        try {
          const resp = await api.addCompetitor(event.id, c.name);
          const created = resp?.competitor;
          if (created && (c.grade || c.actualAge || c.dob || c.heat || c.house || c.bib)) {
            const patch = {};
            if (c.grade)     patch.grade     = c.grade;
            if (c.actualAge) patch.actualAge = c.actualAge;
            if (c.dob)       patch.dob       = c.dob;
            if (c.heat)      patch.heat      = c.heat;
            if (c.house)     patch.house     = c.house;
            if (c.bib)       patch.bib       = c.bib;
            const u = await api.updateCompetitor(event.id, created.id, patch);
            const ev = state.events.find(e => e.id === event.id);
            const local = ev?.competitors.find(x => x.id === created.id);
            if (local && u?.competitor) Object.assign(local, u.competitor);
          } else if (created) {
            const ev = state.events.find(e => e.id === event.id);
            if (ev) ev.competitors.push(created);
          }
          // If a PB was provided, store/update at school level
          if (!isNaN(c.pb) && c.pb != null) {
            try { await savePersonalBest({ name: c.name, title: g.eventTitle, gender: g.gender, value: c.pb, type: event.type, unit: event.unit }); } catch (e) {}
          }
          addedCompetitors++;
        } catch (e) {
          append("err", `✗ Failed: ${escapeHtml(c.name)} → ${escapeHtml(g.eventTitle)} (line ${c.lineNo})`);
          failed++;
        }
      }
    }

    append("ok", `<br/><strong>Done.</strong> Created ${createdEvents} event(s), added ${addedCompetitors} competitor(s)${failed ? `, ${failed} failure(s)` : ""}.`);
    await refreshState();
    renderAdmin();
    $("#btnImportCancel").disabled = false;
    $("#btnImportApply").textContent = "Done";
    setTimeout(() => {
      $("#importModal").hidden = true;
      $("#btnImportApply").textContent = "Apply Import";
      $("#btnImportApply").disabled = true;
    }, 1500);
  }

  // ---------- Wiring ----------
  function wire() {
    $("#enterAdmin").addEventListener("click", openAdminAuth);
    $("#enterLeader").addEventListener("click", openLeaderAuth);

    $("#btnAdminAuthClose").addEventListener("click", () => $("#adminAuthModal").hidden = true);
    $("#btnAdminAuthBack").addEventListener("click", adminAuthBack);
    $("#btnAdminAuthNext").addEventListener("click", adminAuthNext);
    $("#adminAuthModal").addEventListener("keydown", (e) => { if (e.key === "Enter") adminAuthNext(); });
    $("#btnNewSchoolFromPick").addEventListener("click", () => {
      $("#schoolCode").value = genCode();
      setAdminAuthStep("school");
    });
    $("#btnJoinSchoolFromPick").addEventListener("click", () => {
      $("#joinSchoolCode").value = "";
      setAdminAuthStep("joinSchool");
    });

    $("#btnLeaderAuthClose").addEventListener("click", () => $("#leaderAuthModal").hidden = true);
    $("#btnLeaderAuthCancel").addEventListener("click", () => $("#leaderAuthModal").hidden = true);
    $("#btnLeaderAuthSubmit").addEventListener("click", leaderAuthSubmit);
    $("#btnLeaderLookup").addEventListener("click", leaderLookup);
    $("#btnLeaderUseFreeText").addEventListener("click", leaderUseFreeText);
    $("#leaderAuthModal").addEventListener("keydown", (e) => { if (e.key === "Enter") leaderAuthSubmit(); });

    $("#btnSignOut").addEventListener("click", signOut);

    $$(".tab").forEach(t => t.addEventListener("click", () => setView(t.dataset.tab)));

    $("#btnNewEvent").addEventListener("click", () => openNewEventModal());
    ["eventSearch","filterStatus","filterGender","filterAge"].forEach(id => {
      $("#"+id).addEventListener("input", renderEvents);
      $("#"+id).addEventListener("change", renderEvents);
    });

    $("#btnBackEvents").addEventListener("click", () => setView("events"));
    $("#btnEditEvent").addEventListener("click", () => {
      const ev = state.events.find(e => e.id === currentEventId);
      if (ev) openEditEventModal(ev);
    });
    $("#btnDeleteEvent").addEventListener("click", deleteEvent);
    $("#btnAddCompetitor").addEventListener("click", addCompetitor);
    $("#newCompetitorName").addEventListener("keydown", (e) => { if (e.key === "Enter") addCompetitor(); });
    $("#btnSubmitEvent").addEventListener("click", submitEvent);
    $("#btnReopenEvent").addEventListener("click", reopenEvent);
    $("#btnTimerStart").addEventListener("click", startTimer);
    $("#btnTimerStop").addEventListener("click", stopTimer);
    $("#btnTimerReset").addEventListener("click", resetTimer);
    $("#btnTimerStartAll").addEventListener("click", startAllRowTimers);
    $("#btnTimerResetAll").addEventListener("click", resetAllInEvent);

    $("#btnCloseModal").addEventListener("click", () => $("#eventModal").hidden = true);
    $("#btnCancelModal").addEventListener("click", () => $("#eventModal").hidden = true);
    $("#btnSaveModal").addEventListener("click", saveEventModal);
    $("#btnCustomTitle").addEventListener("click", () => {
      const isShown = !$("#evCustomTitle").hidden;
      $("#evCustomTitle").hidden = isShown;
      $("#btnCustomTitle").textContent = isShown ? "Use custom title" : "Use library title";
    });
    $("#evType").addEventListener("change", () => {
      const cur = $("#evUnit").value.trim();
      const oldDefaults = ["seconds","m","ft","lbs","kg",""];
      if (oldDefaults.includes(cur)) $("#evUnit").value = defaultUnitFor($("#evType").value);
    });
    // When admin picks an event title, pre-fill type/attempts/unit from school's library defaults
    $("#evTitle").addEventListener("change", () => {
      if (editingEventId) return;
      const d = defaultsForTitle($("#evTitle").value);
      $("#evType").value = d.type;
      $("#evAttempts").value = d.attempts;
      $("#evUnit").value = d.unit;
    });

    $("#btnExportJson").addEventListener("click", exportData);
    $("#btnSnapshotNow").addEventListener("click", snapshotNow);

    // Roster CSV import
    $("#btnImportRoster").addEventListener("click", openImportModal);
    $("#btnImportTemplate").addEventListener("click", downloadImportTemplate);
    $("#btnImportWorkbook").addEventListener("click", openWorkbookModal);
    $("#btnDownloadWorkbook").addEventListener("click", downloadWorkbook);
    $("#btnWorkbookClose").addEventListener("click", () => $("#workbookModal").hidden = true);
    $("#btnWorkbookCancel").addEventListener("click", () => $("#workbookModal").hidden = true);
    $("#workbookFile").addEventListener("change", (e) => {
      if (e.target.files[0]) handleWorkbookFile(e.target.files[0]);
    });
    $("#btnDaySummary").addEventListener("click", openDaySummary);
    $("#btnSummaryClose").addEventListener("click", () => $("#summaryModal").hidden = true);
    $("#btnPrintSummary").addEventListener("click", () => window.print());

    // Student detail modal — any element with [data-student-name] opens it
    $("#btnStudentClose").addEventListener("click", () => $("#studentModal").hidden = true);
    document.body.addEventListener("click", (e) => {
      const el = e.target.closest("[data-student-name]");
      if (!el) return;
      e.preventDefault();
      openStudentDetail(el.dataset.studentName);
    });
    $("#btnImportClose").addEventListener("click", () => $("#importModal").hidden = true);
    $("#btnImportCancel").addEventListener("click", () => $("#importModal").hidden = true);
    $("#btnImportPreview").addEventListener("click", previewImport);
    $("#btnImportApply").addEventListener("click", applyImport);
    $("#importFile").addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      $("#importFileName").textContent = file.name;
      const reader = new FileReader();
      reader.onload = () => {
        $("#importPaste").value = reader.result;
        previewImport();
      };
      reader.readAsText(file);
    });

    $("#ribbonsOnlyCompleted").addEventListener("change", renderRibbons);
    $("#btnPrintRibbons").addEventListener("click", () => window.print());
    $("#btnPrintLabels").addEventListener("click", printLabels);

    $("#btnAnnounced").addEventListener("click", markAnnounced);
    $("#btnAnnounceSkip").addEventListener("click", skipAnnounceCurrent);
    $("#btnAnnounceRefresh").addEventListener("click", refreshAnnounce);

    $$("input[name='tieMethod']").forEach(r => r.addEventListener("change", () => saveTieMethod(r.value)));
    $("#scoringPlacement").addEventListener("change", saveScoring);
    $("#scoringStandard").addEventListener("change", saveScoring);
    $("#btnSaveAges").addEventListener("click", saveAges);
    $("#btnSaveHouses").addEventListener("click", saveHouses);
    $("#btnAddDivision").addEventListener("click", addDivision);
    $("#btnSaveDivisions").addEventListener("click", saveDivisions);
    $("#btnSaveLibrary").addEventListener("click", saveLibrary);
    $("#btnAddLibTitle").addEventListener("click", addLibTitle);
    $("#btnSaveRules").addEventListener("click", saveRules);

    // School code & admins
    $("#btnChangeSchoolCode").addEventListener("click", startCodeChange);
    $("#btnConfirmCodeChange").addEventListener("click", confirmCodeChange);
    $("#btnCancelCodeChange").addEventListener("click", cancelCodeChange);
    $("#btnInviteAdmin").addEventListener("click", startInvite);
    $("#btnSendInvite").addEventListener("click", sendInvite);
    $("#btnCancelInvite").addEventListener("click", cancelInvite);

    $("#btnInviteAllLeaders").addEventListener("click", inviteAllLeaders);
    $("#btnPrintCredentials").addEventListener("click", printCredentialsSheet);
    $("#requireLeaderPinToggle").addEventListener("change", saveRequireLeaderPin);
    $("#restrictTimerStartsToggle").addEventListener("change", saveRestrictTimerStarts);
    $("#btnAddRecord").addEventListener("click", addRecord);
    $("#standardsTitleFilter").addEventListener("change", renderStandardsEditor);
    $("#btnReseedStandards").addEventListener("click", reseedStandards);
    $("#btnArchiveYear").addEventListener("click", archiveCurrentYear);
    $("#btnResetAll").addEventListener("click", resetAll);

    $("#btnCelebrationClose").addEventListener("click", dismissCelebration);
    $("#btnReferTopbar").addEventListener("click", openReferModal);
    $("#btnReferClose").addEventListener("click", () => $("#referModal").hidden = true);
    $("#btnReferCancel").addEventListener("click", () => $("#referModal").hidden = true);
    $("#btnReferSend").addEventListener("click", sendRefer);

    $("#btnReportTopbar").addEventListener("click", openReportModal);
    $("#btnReportClose").addEventListener("click", () => $("#reportModal").hidden = true);
    $("#btnReportCancel").addEventListener("click", () => $("#reportModal").hidden = true);
    $("#btnReportSend").addEventListener("click", sendReport);

    $("#btnToggleRules").addEventListener("click", () => {
      const card = $("#eventRulesCard");
      const collapsed = card.classList.toggle("collapsed");
      $("#btnToggleRules").textContent = collapsed ? "Show" : "Hide";
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        ["adminAuthModal","leaderAuthModal","eventModal"].forEach(id => $("#"+id).hidden = true);
      }
      if (e.code === "Space" && !$("#view-event-detail").hidden && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        const ev = state.events.find(e => e.id === currentEventId);
        if (ev?.type === "timed" && ev.status !== "completed") {
          e.preventDefault();
          if (timerHandle) stopTimer(); else startTimer();
        }
      }
    });
  }

  // ---------- Boot ----------
  async function boot() {
    wire();
    // Calibrate this browser's clock against the server BEFORE any timer
    // can be started. Best-of-5 round-trip — takes <500ms on most networks.
    // Done in parallel with showApp() to avoid noticeable delay.
    const skewPromise = (api.calibrateClockSkew ? api.calibrateClockSkew() : Promise.resolve(0))
      .catch(() => 0);
    const session = api.getSession();
    if (session && session.schoolId) {
      try { await showApp(); }
      catch (e) { console.warn(e); api.clearSession(); showWelcome(); }
    } else {
      showWelcome();
    }
    // Recalibrate periodically — clocks drift, especially on phones.
    skewPromise.then(() => {
      setInterval(() => { api.calibrateClockSkew && api.calibrateClockSkew(); }, 5 * 60 * 1000);
    });
  }
  document.addEventListener("DOMContentLoaded", boot);
})();
