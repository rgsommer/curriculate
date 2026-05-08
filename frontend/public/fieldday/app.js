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
  function getSchool() { return state.school; }
  function isAdmin() { return api.getSession()?.role === "admin"; }
  function showToast(msg, ms=2200) {
    const el = $("#toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => { el.hidden = true; }, ms);
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
    if (type === "timed") return fmtTimer(value*10);
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
  function showRecordCelebration({ event, name, result, prev }) {
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
      competitorId: competitor.id
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
    $$(".tab[data-admin='1']").forEach(t => t.hidden = !isAdmin());
    setView("events");
    updateAnnounceBadge();
  }

  function showWelcome() {
    stopLivePolling();
    $("#welcomeScreen").hidden = false;
    $("#topbar").hidden = true;
    $("#app").hidden = true;
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
    $("#leaderAuthModal").hidden = false;
    setTimeout(() => $("#leaderSchoolCode").focus(), 50);
  }

  async function leaderAuthSubmit() {
    const code = $("#leaderSchoolCode").value.trim().toUpperCase();
    const name = $("#leaderName").value.trim();
    if (!code) { showToast("Enter the school code"); return; }
    if (!name) { showToast("Enter your name"); return; }
    $("#btnLeaderAuthSubmit").disabled = true;
    try {
      await api.joinAsLeader(code, name);
      $("#leaderAuthModal").hidden = true;
      await showApp();
      showToast(`Welcome, ${name}`);
    } catch (e) {
      showToast(e.message === "school_not_found" ? "School code not found" : "Couldn't join school");
    } finally {
      $("#btnLeaderAuthSubmit").disabled = false;
    }
  }

  async function signOut() {
    await api.signOut();
    state = { school: null, events: [], announceQueue: [] };
    showWelcome();
  }

  // ---------- Events list ----------
  function renderEvents() {
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
    currentEventId = id;
    VIEWS.forEach(v => $(`#view-${v}`).hidden = true);
    $("#view-event-detail").hidden = false;
    renderEventDetail();
    // refresh authoritative copy then re-render
    stopLivePolling();
    stopPoll = api.startPolling((s) => {
      state = { school: s.school || state.school, events: s.events || [], announceQueue: s.announceQueue || [] };
      if (currentEventId && !$("#view-event-detail").hidden) renderEventDetail();
    }, POLL_MS);
  }

  function renderEventDetail() {
    const ev = state.events.find(e => e.id === currentEventId);
    if (!ev) return;
    $("#eventDetailTitle").textContent = ev.title;
    $("#eventDetailMeta").innerHTML = `
      <span>Age ${escapeHtml(ev.age)} · ${escapeHtml(ev.gender)} · ${typeLabel(ev.type)}${ev.unit?" ("+escapeHtml(ev.unit)+")":""} · Best of ${ev.attempts}</span>
      ${ev.notes ? `<span> · ${escapeHtml(ev.notes)}</span>` : ""}
      <span> · Led by ${escapeHtml(ev.leaderName||"")}</span>
    `;
    // Rules card — pulls from school.eventRules keyed by event title
    const ruleText = (state.school?.eventRules || {})[ev.title] || "";
    if (ruleText) {
      $("#eventRulesCard").hidden = false;
      $("#eventRulesText").textContent = ruleText;
    } else {
      $("#eventRulesCard").hidden = true;
    }

    $("#timerCard").hidden = ev.type !== "timed";
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

    const placements = computePlacements(ev, state.school?.tieMethod || "average");
    const list = $("#competitorList");
    list.innerHTML = (ev.competitors||[]).map(c => {
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
      return `
        <div class="competitor-row" data-cid="${c.id}">
          <input class="name-input" value="${escapeHtml(c.name)}" data-cid="${c.id}" placeholder="Competitor name" ${readOnly?"disabled":""} />
          <div class="attempts">${attemptInputs}</div>
          <div class="row-actions">
            ${placeTag}
            ${!readOnly ? `<button class="icon-btn" data-del="${c.id}" title="Remove">🗑</button>` : ""}
          </div>
        </div>`;
    }).join("");

    const sorted = (ev.competitors||[]).map(c => {
      const p = placements.find(x => x.competitorId === c.id);
      return { name: c.name, result: bestOf(c.attempts, ev.type), place: p?.place, points: p?.points };
    }).filter(x => x.result != null).sort((a,b) => compareResults(a.result, b.result, ev.type));
    $("#liveStandings").innerHTML = sorted.length === 0
      ? `<li class="muted">No results yet</li>`
      : sorted.map(s => `
          <li>
            ${s.place ? renderPlaceTag(s.place) : ""}
            <span class="name">${escapeHtml(s.name)}</span>
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
          renderEventDetail();
        } catch (e) { showToast("Save failed"); }
      });
    });
    list.querySelectorAll("[data-del]").forEach(btn => {
      btn.addEventListener("click", async () => {
        try {
          await api.deleteCompetitor(currentEventId, btn.dataset.del);
          const ev2 = state.events.find(e => e.id === currentEventId);
          if (ev2) ev2.competitors = ev2.competitors.filter(c => c.id !== btn.dataset.del);
          renderEventDetail();
        } catch (e) { showToast("Delete failed"); }
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

  // ---------- Timer ----------
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
        advanceTimerTarget();
        renderEventDetail();
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
    try {
      const resp = await api.addCompetitor(currentEventId, name);
      const ev = state.events.find(e => e.id === currentEventId);
      if (ev && resp?.competitor) ev.competitors.push(resp.competitor);
      $("#newCompetitorName").value = "";
      renderEventDetail();
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
  function computePlacements(ev, tieMode = "average") {
    const rows = (ev.competitors||[]).map(c => ({ competitorId: c.id, best: bestOf(c.attempts, ev.type) }));
    const withResults = rows.filter(r => r.best != null);
    const noResults = rows.filter(r => r.best == null);
    withResults.sort((a,b) => compareResults(a.best, b.best, ev.type));
    const groups = [];
    for (const r of withResults) {
      const last = groups[groups.length-1];
      if (last && last[0].best === r.best) last.push(r); else groups.push([r]);
    }
    const placements = [];
    let curPlace = 1;
    for (const group of groups) {
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
    return placements;
  }
  function pointsForPlace(p) { return PLACE_POINTS[p] ?? 0; }

  // ---------- Admin ----------
  function renderAdmin() {
    const events = state.events;
    const completed = events.filter(e => e.status === "completed");
    const inProgress = events.filter(e => e.status === "in_progress");
    const competitors = new Set();
    events.forEach(e => (e.competitors||[]).forEach(c => competitors.add(`${e.age}|${e.gender}|${(c.name||"").toLowerCase()}`)));
    $("#kpiEvents").textContent = events.length;
    $("#kpiCompleted").textContent = completed.length;
    $("#kpiInProgress").textContent = inProgress.length;
    $("#kpiCompetitors").textContent = competitors.size;

    renderOverallStandings(events);
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
      const placements = computePlacements(ev, tieMethod);
      placements.forEach(p => {
        const c = (ev.competitors||[]).find(c => c.id === p.competitorId);
        if (!c || !c.name) return;
        const key = `${ev.gender}|${c.name.trim().toLowerCase()}`;
        let entry = acc.get(key);
        if (!entry) {
          entry = { name: c.name.trim(), gender: ev.gender, ages: new Set(), points: 0 };
          acc.set(key, entry);
        }
        entry.points += (p.points || 0);
        entry.ages.add(String(ev.age));
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
          <span class="name">${escapeHtml(r.name)}</span>
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
                      <td>${escapeHtml(c?.name || "")}</td>
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
    const mode = state.school?.scoringMode || "placement";
    const events = state.events.filter(e => e.status === "completed");
    const labels = [];
    events.forEach(ev => {
      const cat = `Age ${ev.age} ${ev.gender}`;
      if (mode === "placement") {
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
            res: fmtResult(bestOf(c?.attempts, ev.type), ev.type, ev.unit)
          });
        });
      } else {
        // Standard mode
        const std = findStandardForEvent(ev);
        if (!std) return;
        (ev.competitors||[]).forEach(c => {
          const best = bestOf(c.attempts, ev.type);
          if (best == null) return;
          const tier = tierForResult(best, std, ev.type);
          if (!tier) return;
          const placeNames = { gold:"Gold", silver:"Silver", bronze:"Bronze" };
          labels.push({
            place: placeNames[tier], placeClass: tier,
            name: c.name, event: ev.title, cat,
            res: fmtResult(best, ev.type, ev.unit)
          });
        });
      }
    });
    return labels;
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
            <div class="name">${escapeHtml(c?.name||"")}</div>
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
    $$("input[name='scoringMode']").forEach(r => r.checked = (r.value === (school.scoringMode||"placement")));
    $("#ageCategories").value = (school.ageCategories||[]).join(", ");
    $("#ageBands").value = (school.ageBands||[]).join(", ");
    $("#eventLibrary").value = (school.eventLibrary||[]).join("\n");
    $("#standardsCard").hidden = (school.scoringMode||"placement") !== "standard";
    renderSchoolCodeCard();
    renderRulesEditor();
    renderRecordsEditor();
    renderStandardsEditor();
    renderArchives();
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
  async function saveScoringMode(v) {
    try {
      const resp = await api.updateSchool({ scoringMode: v });
      if (resp?.school) state.school = resp.school;
      $("#standardsCard").hidden = v !== "standard";
      renderStandardsEditor();
      showToast("Scoring mode updated");
    } catch (e) { showToast("Save failed"); }
  }
  async function saveAges() {
    const cats  = $("#ageCategories").value.split(",").map(s => s.trim()).filter(Boolean);
    const bands = $("#ageBands").value.split(",").map(s => s.trim()).filter(Boolean);
    if (cats.length === 0)  { showToast("Need at least one age category"); return; }
    if (bands.length === 0) { showToast("Need at least one age band"); return; }
    try {
      const resp = await api.updateSchool({ ageCategories: cats, ageBands: bands });
      if (resp?.school) state.school = resp.school;
      showToast("Ages & bands saved");
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
    const list = $("#eventLibrary").value.split("\n").map(s => s.trim()).filter(Boolean);
    if (list.length === 0) { showToast("Need at least one event title"); return; }
    try {
      const resp = await api.updateSchool({ eventLibrary: list });
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
            <button class="btn" data-restore="${a.id}">Restore</button>
            <button class="btn danger ghost" data-delete="${a.id}">Delete</button>
          </div>
        </div>`;
    }).join("");
    list.querySelectorAll("[data-restore]").forEach(btn => btn.addEventListener("click", () => restoreArchive(btn.dataset.restore)));
    list.querySelectorAll("[data-delete]").forEach(btn => btn.addEventListener("click", () => deleteArchive(btn.dataset.delete)));
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
  async function resetAll() {
    if (!confirm("Sign out of this device? Your school's data stays in Curriculate; you can sign back in any time.")) return;
    try { await api.signOut(); } catch (e) {}
    api.clearSession();
    state = { school: null, events: [], announceQueue: [] };
    showWelcome();
    showToast("Signed out");
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

    $("#btnExportJson").addEventListener("click", exportData);

    $("#ribbonsOnlyCompleted").addEventListener("change", renderRibbons);
    $("#btnPrintRibbons").addEventListener("click", () => window.print());
    $("#btnPrintLabels").addEventListener("click", printLabels);

    $("#btnAnnounced").addEventListener("click", markAnnounced);
    $("#btnAnnounceSkip").addEventListener("click", skipAnnounceCurrent);
    $("#btnAnnounceRefresh").addEventListener("click", refreshAnnounce);

    $$("input[name='tieMethod']").forEach(r => r.addEventListener("change", () => saveTieMethod(r.value)));
    $$("input[name='scoringMode']").forEach(r => r.addEventListener("change", () => saveScoringMode(r.value)));
    $("#btnSaveAges").addEventListener("click", saveAges);
    $("#btnSaveLibrary").addEventListener("click", saveLibrary);
    $("#btnSaveRules").addEventListener("click", saveRules);

    // School code & admins
    $("#btnChangeSchoolCode").addEventListener("click", startCodeChange);
    $("#btnConfirmCodeChange").addEventListener("click", confirmCodeChange);
    $("#btnCancelCodeChange").addEventListener("click", cancelCodeChange);
    $("#btnInviteAdmin").addEventListener("click", startInvite);
    $("#btnSendInvite").addEventListener("click", sendInvite);
    $("#btnCancelInvite").addEventListener("click", cancelInvite);
    $("#btnAddRecord").addEventListener("click", addRecord);
    $("#standardsTitleFilter").addEventListener("change", renderStandardsEditor);
    $("#btnReseedStandards").addEventListener("click", reseedStandards);
    $("#btnArchiveYear").addEventListener("click", archiveCurrentYear);
    $("#btnResetAll").addEventListener("click", resetAll);

    $("#btnCelebrationClose").addEventListener("click", dismissCelebration);

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
    const session = api.getSession();
    if (session && session.schoolId) {
      try { await showApp(); }
      catch (e) { console.warn(e); api.clearSession(); showWelcome(); }
    } else {
      showWelcome();
    }
  }
  document.addEventListener("DOMContentLoaded", boot);
})();
