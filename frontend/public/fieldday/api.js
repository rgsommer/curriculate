/* ============================================================
 * Field Day — API client
 *
 * Talks to the Curriculate backend at FIELDDAY_API_BASE (default
 * "/fieldday/api"). Falls back to localStorage when the backend
 * is unreachable or returns 404, so the app remains usable on
 * a single device while the server side is being built.
 *
 * Exposes a single global: window.FieldDayAPI
 *
 * See BACKEND.md for the full endpoint contract this module
 * expects on the server side.
 * ============================================================ */
(() => {
  "use strict";

  // ---------- Config ----------
  const API_BASE = (typeof window !== "undefined" && window.FIELDDAY_API_BASE) || "/fieldday/api";
  const STORAGE_KEY = "fielddayData";        // local cache + offline fallback
  const SESSION_KEY = "fielddaySession";     // { token, role, schoolId, leaderName?, email? }
  const MODE_KEY   = "fielddayMode";         // "remote" | "local" — sticky once detected

  // ---------- Mode detection ----------
  // We optimistically try the backend on first call; if it fails (network
  // error or 404), we permanently switch to local mode for this tab.
  let mode = localStorage.getItem(MODE_KEY) || "auto"; // "auto" | "remote" | "local"

  function setMode(m) { mode = m; try { localStorage.setItem(MODE_KEY, m); } catch (e) {} }

  function isLocal() { return mode === "local"; }
  function isRemote() { return mode === "remote"; }

  // ---------- Local-mode storage helpers ----------
  function readLocal() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultStateBlob();
      const parsed = JSON.parse(raw);
      if (!parsed.schools) parsed.schools = [];
      if (!parsed.events) parsed.events = [];
      if (!parsed.announceQueue) parsed.announceQueue = [];
      return parsed;
    } catch (e) { return defaultStateBlob(); }
  }
  function writeLocal(blob) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(blob)); } catch (e) {}
  }
  function defaultStateBlob() { return { schools: [], events: [], announceQueue: [] }; }

  function readSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); }
    catch (e) { return null; }
  }
  function writeSession(s) {
    if (!s) localStorage.removeItem(SESSION_KEY);
    else localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  }

  // ---------- HTTP helper ----------
  async function http(method, path, body) {
    const session = readSession();
    const headers = { "Accept": "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (session?.token) headers["Authorization"] = "Bearer " + session.token;

    let res;
    try {
      res = await fetch(API_BASE + path, {
        method,
        headers,
        credentials: "same-origin",
        body: body !== undefined ? JSON.stringify(body) : undefined
      });
    } catch (e) {
      // Network error — flip to local mode permanently for this tab.
      if (mode !== "local") { setMode("local"); console.info("[fieldday] backend unreachable, using local mode"); }
      const err = new Error("network"); err.code = "NETWORK"; throw err;
    }

    if (res.status === 404 && !isLocal()) {
      setMode("local");
      console.info("[fieldday] backend returned 404, using local mode");
      const err = new Error("not_found"); err.code = "NOT_FOUND"; throw err;
    }
    if (res.status === 401) {
      writeSession(null);
      const err = new Error("unauthorized"); err.code = "UNAUTHORIZED"; throw err;
    }
    if (!res.ok) {
      let msg = "request_failed";
      try { const j = await res.json(); msg = j.error || j.message || msg; } catch (e) {}
      const err = new Error(msg); err.code = res.status; throw err;
    }
    if (res.status === 204) return null;
    setMode("remote");
    return await res.json();
  }

  // ---------- Helpers ----------
  function uid() { return Math.random().toString(36).slice(2, 10); }

  // ============================================================
  // Public surface
  // ============================================================

  const FieldDayAPI = {
    // ---------- Mode ----------
    getMode() { return mode; },
    isLocal,
    isRemote,
    /** Force local mode (useful for offline-first demos). */
    forceLocalMode() { setMode("local"); },
    /** Try remote mode again (next call will probe the backend). */
    resetMode() { setMode("auto"); localStorage.removeItem(MODE_KEY); },

    // ---------- Session ----------
    /** Returns the current session ({role, schoolId, ...}) or null. */
    getSession: readSession,
    clearSession() { writeSession(null); },

    // ---------- Auth ----------
    /**
     * Admin: request a passkey by email.
     * Server contract: POST /admin/request-passkey {email}
     *   200 {emailed:true, hasSchools:boolean}    — passkey was emailed
     *   200 {emailed:false, devPasskey:"123456"}  — dev fallback (echoes the passkey)
     * Local fallback generates a passkey on the device and returns it for on-screen display.
     */
    async requestAdminPasskey(email) {
      if (isLocal()) return localRequestAdminPasskey(email);
      try {
        return await http("POST", "/admin/request-passkey", { email });
      } catch (e) {
        if (e.code === "NETWORK" || e.code === "NOT_FOUND") return localRequestAdminPasskey(email);
        throw e;
      }
    },

    /**
     * Admin: verify the passkey emailed to them.
     * Server contract: POST /admin/verify-passkey {email, passkey}
     *   200 {sessionToken, schools:[{id,name,code,createdAt}]}
     *   401 {error:"bad_passkey"}
     */
    async verifyAdminPasskey(email, passkey) {
      if (isLocal()) return localVerifyAdminPasskey(email, passkey);
      try {
        const out = await http("POST", "/admin/verify-passkey", { email, passkey });
        writeSession({ token: out.sessionToken, role: "admin", email, schoolId: null });
        return out;
      } catch (e) {
        if (e.code === "NETWORK" || e.code === "NOT_FOUND") return localVerifyAdminPasskey(email, passkey);
        throw e;
      }
    },

    /**
     * Admin: create a new school. Caller must already be admin-authenticated.
     * Server contract: POST /schools {name, code} → {school}
     */
    async createSchool(name, code) {
      if (isLocal()) return localCreateSchool(name, code);
      try {
        const out = await http("POST", "/schools", { name, code });
        const s = readSession() || {};
        writeSession({ ...s, schoolId: out.school.id });
        return out;
      } catch (e) {
        if (e.code === "NETWORK" || e.code === "NOT_FOUND") return localCreateSchool(name, code);
        throw e;
      }
    },

    /**
     * Admin: join an EXISTING school using its school code.
     * Server contract: POST /admin/join-school {schoolCode}
     *   200 {school}      — current admin email is added to school.adminEmails
     *   404 {error:"school_not_found"}
     * Local fallback adds the email to school.adminEmails.
     */
    async joinSchoolAsAdmin(schoolCode) {
      if (isLocal()) return localJoinSchoolAsAdmin(schoolCode);
      try {
        const out = await http("POST", "/admin/join-school", { schoolCode });
        const s = readSession() || {};
        writeSession({ ...s, schoolId: out.school.id });
        return out;
      } catch (e) {
        if (e.code === "NETWORK" || e.code === "NOT_FOUND") return localJoinSchoolAsAdmin(schoolCode);
        throw e;
      }
    },

    /**
     * Master admin: request a confirmation code (emailed to master) to change
     * the school code. POST /schools/me/code-change-request → {confirmationSent:true}
     */
    async requestSchoolCodeChange() {
      if (isLocal()) return localRequestSchoolCodeChange();
      try { return await http("POST", "/schools/me/code-change-request", {}); }
      catch (e) {
        if (e.code === "NETWORK" || e.code === "NOT_FOUND") return localRequestSchoolCodeChange();
        throw e;
      }
    },

    /**
     * Confirm + apply a school-code change with the code emailed to master.
     * POST /schools/me/code-change {newCode, confirmationCode} → {school}
     */
    async confirmSchoolCodeChange(newCode, confirmationCode) {
      if (isLocal()) return localConfirmSchoolCodeChange(newCode, confirmationCode);
      try {
        return await http("POST", "/schools/me/code-change", { newCode, confirmationCode });
      } catch (e) {
        if (e.code === "NETWORK" || e.code === "NOT_FOUND") return localConfirmSchoolCodeChange(newCode, confirmationCode);
        throw e;
      }
    },

    /**
     * Send the school code to a fellow admin via email.
     * POST /schools/me/invite-admin {email} → {sent:true}
     */
    async inviteAdmin(email) {
      if (isLocal()) return localInviteAdmin(email);
      try { return await http("POST", "/schools/me/invite-admin", { email }); }
      catch (e) {
        if (e.code === "NETWORK" || e.code === "NOT_FOUND") return localInviteAdmin(email);
        throw e;
      }
    },

    /** Admin: pick which school to log in to (when one email has many). */
    async selectSchool(schoolId) {
      const s = readSession() || {};
      writeSession({ ...s, schoolId });
      if (isRemote()) {
        try { await http("POST", "/admin/select-school", { schoolId }); } catch (e) {}
      }
      return { ok: true };
    },

    /**
     * Public: list staff names registered for a school (no auth).
     * Lets the leader-sign-in dropdown pre-populate before they're authenticated.
     * Server contract: GET /leader/staff?code=ABC → {school:{name,code}, staff:[name...]}
     *   404 {error:"school_not_found"}
     */
    async lookupSchoolStaff(schoolCode) {
      if (isLocal()) return localLookupSchoolStaff(schoolCode);
      try {
        return await http("GET", "/leader/staff?code=" + encodeURIComponent(schoolCode));
      } catch (e) {
        if (e.code === "NETWORK" || e.code === "NOT_FOUND") return localLookupSchoolStaff(schoolCode);
        throw e;
      }
    },

    /**
     * Leader: join a school by code.
     * Server contract: POST /leader/join {schoolCode, leaderName}
     *   200 {sessionToken, school:{id,name,code,...}}
     *   404 {error:"school_not_found"}
     */
    async joinAsLeader(schoolCode, leaderName) {
      if (isLocal()) return localJoinAsLeader(schoolCode, leaderName);
      try {
        const out = await http("POST", "/leader/join", { schoolCode, leaderName });
        writeSession({ token: out.sessionToken, role: "leader", schoolId: out.school.id, leaderName });
        return out;
      } catch (e) {
        if (e.code === "NETWORK" || e.code === "NOT_FOUND") return localJoinAsLeader(schoolCode, leaderName);
        throw e;
      }
    },

    async signOut() {
      if (isRemote()) { try { await http("POST", "/sign-out", {}); } catch (e) {} }
      writeSession(null);
      return { ok: true };
    },

    // ---------- State (snapshot) ----------
    /**
     * Fetch the full state for the current school (events, archives, settings, queue).
     * Server contract: GET /state → {school, events, announceQueue}
     * If no session, returns the empty cached blob (so app can boot to welcome).
     */
    async fetchState() {
      const session = readSession();
      if (!session?.schoolId) return { school: null, events: [], announceQueue: [] };
      if (isLocal()) return localFetchState(session);
      try {
        return await http("GET", "/state");
      } catch (e) {
        if (e.code === "NETWORK" || e.code === "NOT_FOUND") return localFetchState(session);
        throw e;
      }
    },

    // ---------- Events ----------
    /** POST /events {event} → {event} */
    async createEvent(ev)        { return mutate("POST",   "/events", ev,                                              (b) => localCreateEvent(b)); },
    /** PATCH /events/:id {patch} → {event} */
    async updateEvent(id, patch) { return mutate("PATCH",  "/events/" + encodeURIComponent(id), patch,                  (b) => localUpdateEvent(id, b)); },
    /** DELETE /events/:id */
    async deleteEvent(id)        { return mutate("DELETE", "/events/" + encodeURIComponent(id), undefined,             ()    => localDeleteEvent(id)); },
    /** POST /events/:id/submit → {event} (status=completed) */
    async submitEvent(id)        { return mutate("POST",   "/events/" + encodeURIComponent(id) + "/submit", {},        ()    => localSubmitEvent(id)); },
    /** POST /events/:id/reopen → {event} */
    async reopenEvent(id)        { return mutate("POST",   "/events/" + encodeURIComponent(id) + "/reopen", {},        ()    => localReopenEvent(id)); },

    // ---------- Competitors ----------
    /** POST /events/:id/competitors {name} → {competitor} */
    async addCompetitor(eventId, name)                  { return mutate("POST",   `/events/${encodeURIComponent(eventId)}/competitors`, { name },                       () => localAddCompetitor(eventId, name)); },
    /** PATCH /events/:id/competitors/:cid {patch} → {competitor} */
    async updateCompetitor(eventId, cid, patch)         { return mutate("PATCH",  `/events/${encodeURIComponent(eventId)}/competitors/${encodeURIComponent(cid)}`, patch, () => localUpdateCompetitor(eventId, cid, patch)); },
    /** DELETE /events/:id/competitors/:cid */
    async deleteCompetitor(eventId, cid)                { return mutate("DELETE", `/events/${encodeURIComponent(eventId)}/competitors/${encodeURIComponent(cid)}`, undefined, () => localDeleteCompetitor(eventId, cid)); },
    /** PUT /events/:id/competitors/:cid/attempts/:idx {value} → {competitor} */
    async setAttempt(eventId, cid, attemptIdx, value)   { return mutate("PUT",    `/events/${encodeURIComponent(eventId)}/competitors/${encodeURIComponent(cid)}/attempts/${attemptIdx}`, { value }, () => localSetAttempt(eventId, cid, attemptIdx, value)); },

    // ---------- School / settings ----------
    /** PATCH /schools/me {tieMethod?, ageCategories?, eventLibrary?} → {school} */
    async updateSchool(patch) { return mutate("PATCH", "/schools/me", patch, () => localUpdateSchool(patch)); },

    // ---------- Archives (start a new year) ----------
    /** POST /schools/me/archives {label} → {archive} */
    async archiveSeason(label) { return mutate("POST", "/schools/me/archives", { label }, () => localArchiveSeason(label)); },
    /** POST /schools/me/archives/:id/restore → {archive, eventsRestored} */
    async restoreArchive(archiveId) { return mutate("POST", `/schools/me/archives/${encodeURIComponent(archiveId)}/restore`, {}, () => localRestoreArchive(archiveId)); },
    /** DELETE /schools/me/archives/:id */
    async deleteArchive(archiveId) { return mutate("DELETE", `/schools/me/archives/${encodeURIComponent(archiveId)}`, undefined, () => localDeleteArchive(archiveId)); },

    // ---------- Announcer ----------
    /** POST /announce/:id/announced → {ok:true} */
    async markAnnounced(eventId) { return mutate("POST", `/announce/${encodeURIComponent(eventId)}/announced`, {}, () => localMarkAnnounced(eventId)); },
    /** POST /announce/:id/skip → moves to back of queue */
    async skipAnnounce(eventId)  { return mutate("POST", `/announce/${encodeURIComponent(eventId)}/skip`, {},      () => localSkipAnnounce(eventId)); },

    // ---------- School Records ----------
    /** POST /schools/me/records {title,age,gender,type,value,holderName,dateSet} → {record} */
    async createRecord(record) { return mutate("POST", "/schools/me/records", record, () => localCreateRecord(record)); },
    /** PATCH /schools/me/records/:id {patch} → {record} */
    async updateRecord(id, patch) { return mutate("PATCH", `/schools/me/records/${encodeURIComponent(id)}`, patch, () => localUpdateRecord(id, patch)); },
    /** DELETE /schools/me/records/:id */
    async deleteRecord(id) { return mutate("DELETE", `/schools/me/records/${encodeURIComponent(id)}`, undefined, () => localDeleteRecord(id)); },

    /**
     * Helper: regenerate the default-standards seed for the current school,
     * given the current ageBands + eventLibrary. Returns an array of standard
     * objects (without persisting). The caller is responsible for choosing
     * whether to merge or replace.
     */
    seedStandards(ageBands, eventLibrary) { return seedStandardsFor(ageBands, eventLibrary); },

    // ---------- Standards (used by standard-based scoring mode) ----------
    /** POST /schools/me/standards {title,age,gender,type,gold,silver,bronze} → {standard} */
    async createStandard(s)   { return mutate("POST",   "/schools/me/standards", s, () => localCreateStandard(s)); },
    /** PATCH /schools/me/standards/:id {patch} → {standard} */
    async updateStandard(id, patch) { return mutate("PATCH", `/schools/me/standards/${encodeURIComponent(id)}`, patch, () => localUpdateStandard(id, patch)); },
    /** DELETE /schools/me/standards/:id */
    async deleteStandard(id)  { return mutate("DELETE", `/schools/me/standards/${encodeURIComponent(id)}`, undefined, () => localDeleteStandard(id)); },

    // ---------- Polling ----------
    /**
     * Poll fetchState every ms milliseconds, calling onChange(state) when
     * the JSON-stringified state actually changes. Returns a stop function.
     */
    startPolling(onChange, ms = 6000) {
      let last = null;
      let stopped = false;
      const tick = async () => {
        if (stopped) return;
        try {
          const s = await this.fetchState();
          const sig = JSON.stringify(s);
          if (sig !== last) { last = sig; onChange(s); }
        } catch (e) { /* swallow polling errors */ }
        if (!stopped) setTimeout(tick, ms);
      };
      tick();
      return () => { stopped = true; };
    },

    // ---------- Local cache passthrough (used by Export/Import) ----------
    /** Returns the full local blob (schools/events/announceQueue) — used for export. */
    readLocalBlob: readLocal,
    /** Replaces the full local blob — used for import. */
    writeLocalBlob: writeLocal,
  };

  // ============================================================
  // mutate(): central try-remote-then-fallback wrapper
  // ============================================================
  async function mutate(method, path, body, localFn) {
    if (isLocal()) return localFn();
    try {
      return await http(method, path, body);
    } catch (e) {
      if (e.code === "NETWORK" || e.code === "NOT_FOUND") return localFn();
      throw e;
    }
  }

  // ============================================================
  // Local-mode implementations (mirror the server semantics so
  // the app behaves identically on a single device).
  // ============================================================

  // ---- auth ----
  function localRequestAdminPasskey(email) {
    const blob = readLocal();
    const matches = (blob.schools || []).filter(s => s.adminEmail === email);
    if (matches.length > 0) {
      // existing — no passkey echo, user must remember the one stored on device
      return { emailed: false, devPasskey: null, hasSchools: true };
    }
    const passkey = String(Math.floor(100000 + Math.random()*900000));
    // stash a "pending registration" so verify can complete
    blob._pending = { email, passkey, ts: Date.now() };
    writeLocal(blob);
    return { emailed: false, devPasskey: passkey, hasSchools: false };
  }

  function localVerifyAdminPasskey(email, passkey) {
    const blob = readLocal();
    // Per-email passkey is now stored in blob._adminPasskeys[email] (the latest one).
    const stored = (blob._adminPasskeys||{})[email];
    const pending = blob._pending && blob._pending.email === email && blob._pending.passkey === passkey;
    if (stored === passkey || pending) {
      // Find any schools where this email is in adminEmails (or is the legacy adminEmail field).
      const matches = (blob.schools||[]).filter(s =>
        (s.adminEmails||[]).includes(email) || s.adminEmail === email);
      const token = "local-" + uid();
      writeSession({
        token, role: "admin", email,
        schoolId: matches.length === 1 ? matches[0].id : null,
        _pendingPasskey: pending ? passkey : undefined
      });
      // Stash this passkey as the user's authenticated passkey for future signins.
      blob._adminPasskeys = blob._adminPasskeys || {};
      blob._adminPasskeys[email] = passkey;
      delete blob._pending;
      writeLocal(blob);
      return { sessionToken: token, schools: matches.map(({id, name, code, createdAt}) => ({id, name, code, createdAt})) };
    }
    const err = new Error("bad_passkey"); err.code = 401; throw err;
  }

  // ---- standard templates (seed defaults for the default event library) ----
  // Numbers are STARTING POINTS only — admins should adjust for their region.
  // Format per event: gold formula by band index (0=youngest, 4=oldest), then
  // a `gap` that's added once for silver and again for bronze.
  // Timed events: gap is positive (silver is slower than gold).
  // Distance/weight: gap is negative (silver is shorter than gold).
  const STANDARD_TEMPLATES = {
    "50m Sprint":         { type: "timed",    unit: "seconds", girls: bi => 11.0 - bi*0.6,  boys: bi => 10.5 - bi*0.6,  gap: 1.0 },
    "100m Sprint":        { type: "timed",    unit: "seconds", girls: bi => 22.0 - bi*1.2,  boys: bi => 21.0 - bi*1.2,  gap: 2.0 },
    "200m Sprint":        { type: "timed",    unit: "seconds", girls: bi => 50.0 - bi*3.0,  boys: bi => 47.0 - bi*3.0,  gap: 5.0 },
    "400m Run":           { type: "timed",    unit: "seconds", girls: bi => 110  - bi*8,    boys: bi => 105  - bi*8,    gap: 12 },
    "800m Run":           { type: "timed",    unit: "seconds", girls: bi => 260  - bi*20,   boys: bi => 245  - bi*20,   gap: 25 },
    "Hurdles":            { type: "timed",    unit: "seconds", girls: bi => 14   - bi*0.8,  boys: bi => 13.5 - bi*0.8,  gap: 1.5 },
    "Long Jump":          { type: "distance", unit: "m",       girls: bi => 0.7  + bi*0.4,  boys: bi => 0.8  + bi*0.4,  gap: -0.2 },
    "Standing Long Jump": { type: "distance", unit: "m",       girls: bi => 0.6  + bi*0.3,  boys: bi => 0.7  + bi*0.3,  gap: -0.15 },
    "High Jump":          { type: "distance", unit: "m",       girls: bi => 0.5  + bi*0.2,  boys: bi => 0.55 + bi*0.2,  gap: -0.1 },
    "Triple Jump":        { type: "distance", unit: "m",       girls: bi => 2.0  + bi*1.0,  boys: bi => 2.2  + bi*1.0,  gap: -0.5 },
    "Shot Put":           { type: "distance", unit: "m",       girls: bi => 2.5  + bi*1.2,  boys: bi => 3.0  + bi*1.5,  gap: -0.5 },
    "Softball Throw":     { type: "distance", unit: "m",       girls: bi => 8    + bi*5,    boys: bi => 10   + bi*7,    gap: -2 },
    "Cricket Ball Throw": { type: "distance", unit: "m",       girls: bi => 12   + bi*6,    boys: bi => 14   + bi*8,    gap: -3 },
    "Vortex Throw":       { type: "distance", unit: "m",       girls: bi => 15   + bi*5,    boys: bi => 18   + bi*7,    gap: -3 },
    "Frisbee Throw":      { type: "distance", unit: "m",       girls: bi => 10   + bi*4,    boys: bi => 12   + bi*5,    gap: -2 },
    "Football Throw":     { type: "distance", unit: "m",       girls: bi => 8    + bi*4,    boys: bi => 10   + bi*6,    gap: -2 }
  };

  function round1(n) { return Math.round(n * 10) / 10; }

  /**
   * Generates a default set of standards for every (template-known event,
   * age band, gender) tuple. Returned objects do NOT include id; caller
   * should id them.
   */
  function seedStandardsFor(ageBands, eventLibrary) {
    const out = [];
    for (const title of (eventLibrary||[])) {
      const tpl = STANDARD_TEMPLATES[title];
      if (!tpl) continue;
      for (let bi = 0; bi < ageBands.length; bi++) {
        for (const gender of ["Girls","Boys"]) {
          const goldFn = gender === "Girls" ? tpl.girls : tpl.boys;
          const gold = round1(goldFn(bi));
          const silver = round1(gold + tpl.gap);
          const bronze = round1(silver + tpl.gap);
          out.push({
            id: uid(),
            title,
            ageBand: ageBands[bi],
            gender,
            type: tpl.type,
            unit: tpl.unit,
            gold, silver, bronze
          });
        }
      }
    }
    return out;
  }

  // ---- default event rules (admin-editable) ----
  const DEFAULT_EVENT_RULES = {
    "50m Sprint":         "Standing start at the line, on the official's signal. Run straight in your lane to the finish. Time stops when the chest crosses the finish line. False starts are restarted.",
    "100m Sprint":        "Standing start. Stay in your lane. Time stops when the chest crosses the finish.",
    "200m Sprint":        "Stagger-start in lanes. Stay in your lane the whole way (no cutting). Time stops at the chest at the finish.",
    "400m Run":           "One lap. Stagger-start in lanes for the first 100m, then break for the inside. Time stops at the chest.",
    "800m Run":           "Two laps. Mass start. Inside lane preferred after the first turn. Time stops at the chest.",
    "Hurdles":            "Standing start. Clear each hurdle without going around it. Time stops at the chest at the finish.",
    "Relay Race":         "Each runner completes one leg. Pass the baton within the marked exchange zone. Drop = your team picks it up; no help from outside.",
    "Long Jump":          "Sprint approach. Take off on or before the take-off line — a foot over the line is a foul (no measurement). Distance measured from the take-off line to the nearest mark in the pit. Three attempts; best counts.",
    "Standing Long Jump": "Toes behind the line, no run-up. Jump from a standstill with two feet. Measured to the nearest body-part mark. Three attempts; best counts.",
    "High Jump":          "Approach and jump over the bar without knocking it down. Three attempts at each height. Eliminated after three consecutive misses. Best successful height counts.",
    "Triple Jump":        "Hop, step, and jump from the take-off board. Foot may not cross the take-off line. Three attempts; best counts.",
    "Shot Put":           "Throw from inside the throwing circle, holding the shot near the chin. Push (don't throw). Foot may not touch the front of the circle. Three attempts; best counts.",
    "Softball Throw":     "Throw from behind the throwing line. No run-up across the line. Distance measured from the line to where the ball first lands. Three attempts; best counts.",
    "Cricket Ball Throw": "Throw from behind the throwing line. Measured from line to first landing point. Three attempts; best counts.",
    "Vortex Throw":       "Throw the vortex from behind the line. Measured from line to first landing point. Three attempts; best counts.",
    "Frisbee Throw":      "Throw from behind the line. Measured from line to first landing point. Three attempts; best counts.",
    "Football Throw":     "Throw from behind the line. Measured from line to first landing point. Three attempts; best counts.",
    "Sack Race":          "Both feet inside the sack at all times. Hop to the finish line. Falling is fine — get back in the sack and continue.",
    "Three-Legged Race":  "Inside legs tied together. Both partners must cross the finish line. Untied = restart from where it came undone.",
    "Egg & Spoon Race":   "Egg in spoon, one hand only. Drop = stop, replace, continue. No covering the egg with your hand.",
    "Wheelbarrow Race":   "One partner walks on hands; the other holds their ankles. Both must finish in position.",
    "Tug of War":         "Teams of equal size. Pull until the center marker crosses the line. Best of 3 pulls. No sitting or wrapping the rope.",
    "Obstacle Course":    "Complete every obstacle in order. Any skipped obstacle = restart that section. Time stops at the finish."
  };

  function localCreateSchool(name, code) {
    const blob = readLocal();
    if ((blob.schools||[]).some(s => s.code === code)) {
      const err = new Error("code_taken"); err.code = 409; throw err;
    }
    const session = readSession() || {};
    const passkey = (blob._pending && blob._pending.email === session.email && blob._pending.passkey)
      || session._pendingPasskey
      || String(Math.floor(100000 + Math.random()*900000));
    const ageBands = ["5-6","7-8","9-10","11-12","13-14"];
    const eventLibrary = ["50m Sprint","100m Sprint","200m Sprint","400m Run","800m Run","Hurdles","Relay Race","Long Jump","Standing Long Jump","High Jump","Triple Jump","Shot Put","Softball Throw","Cricket Ball Throw","Vortex Throw","Frisbee Throw","Football Throw","Sack Race","Three-Legged Race","Egg & Spoon Race","Wheelbarrow Race","Tug of War","Obstacle Course"];
    const school = {
      id: uid(),
      name, code,
      masterAdminEmail: session.email,
      adminEmails: [session.email],
      adminEmail: session.email, // legacy compatibility
      passkey, // legacy compatibility — passkeys are now per-email under blob._adminPasskeys
      ageCategories: ["5","6","7","8","9","10","11","12","13","14"],
      ageBands,
      eventLibrary,
      // eventRules can be either a string (legacy: just the base rule)
      // or { base: "...", byDivision: { "Junior": "..." } }. Reader normalizes.
      eventRules: { ...DEFAULT_EVENT_RULES },
      tieMethod: "average",
      scoring: { placement: true, standard: false },
      scoringMode: "placement", // legacy compatibility
      ageCutoffDate: "12-31",
      houses: [],
      divisions: [
        { name: "Junior",       ageRange: [5, 8]  },
        { name: "Intermediate", ageRange: [9, 11] },
        { name: "Senior",       ageRange: [12, 14] }
      ],
      eventStaff: { /* { eventTitle: { divisionName: { Leader: "...", Assistant: "..." } } } */ },
      personalBests: [],
      eventDefaults: { /* keyed by title: {type, attempts, unit} */ },
      records: [],
      standards: seedStandardsFor(ageBands, eventLibrary),
      archives: [],
      createdAt: Date.now()
    };
    blob.schools.push(school);
    delete blob._pending;
    writeLocal(blob);
    writeSession({ ...session, schoolId: school.id, _pendingPasskey: undefined });
    return { school };
  }

  function localLookupSchoolStaff(schoolCode) {
    const blob = readLocal();
    const school = (blob.schools||[]).find(s => s.code === schoolCode);
    if (!school) { const err = new Error("school_not_found"); err.code = 404; throw err; }
    const names = new Set();
    Object.values(school.eventStaff || {}).forEach(byDiv => {
      Object.values(byDiv || {}).forEach(byRole => {
        Object.values(byRole || {}).forEach(name => { if (name && String(name).trim()) names.add(String(name).trim()); });
      });
    });
    return { school: { name: school.name, code: school.code }, staff: [...names].sort() };
  }

  function localJoinAsLeader(schoolCode, leaderName) {
    const blob = readLocal();
    const school = (blob.schools||[]).find(s => s.code === schoolCode);
    if (!school) { const err = new Error("school_not_found"); err.code = 404; throw err; }
    const token = "local-" + uid();
    writeSession({ token, role: "leader", schoolId: school.id, leaderName });
    return { sessionToken: token, school: { id: school.id, name: school.name, code: school.code } };
  }

  // ---- state ----
  function localFetchState(session) {
    const blob = readLocal();
    const school = (blob.schools||[]).find(s => s.id === session.schoolId) || null;
    const events = (blob.events||[]).filter(e => e.schoolId === session.schoolId);
    const announceQueue = (blob.announceQueue||[]).filter(id => events.some(e => e.id === id));
    return { school, events, announceQueue };
  }

  // ---- events ----
  function localCreateEvent(ev) {
    const blob = readLocal();
    const session = readSession() || {};
    const event = { ...ev, id: ev.id || uid(), schoolId: session.schoolId, status: "in_progress", createdAt: Date.now(), competitors: ev.competitors || [] };
    blob.events.push(event);
    writeLocal(blob);
    return { event };
  }
  function localUpdateEvent(id, patch) {
    const blob = readLocal();
    const ev = blob.events.find(e => e.id === id);
    if (!ev) { const err = new Error("not_found"); err.code = 404; throw err; }
    Object.assign(ev, patch);
    writeLocal(blob);
    return { event: ev };
  }
  function localDeleteEvent(id) {
    const blob = readLocal();
    blob.events = blob.events.filter(e => e.id !== id);
    blob.announceQueue = (blob.announceQueue||[]).filter(x => x !== id);
    writeLocal(blob);
    return { ok: true };
  }
  function localSubmitEvent(id) {
    const blob = readLocal();
    const ev = blob.events.find(e => e.id === id);
    if (!ev) { const err = new Error("not_found"); err.code = 404; throw err; }
    ev.status = "completed";
    ev.completedAt = Date.now();
    if (!blob.announceQueue.includes(id)) blob.announceQueue.push(id);
    writeLocal(blob);
    return { event: ev };
  }
  function localReopenEvent(id) {
    const blob = readLocal();
    const ev = blob.events.find(e => e.id === id);
    if (!ev) { const err = new Error("not_found"); err.code = 404; throw err; }
    ev.status = "in_progress";
    ev.completedAt = null;
    ev.announcedAt = null;
    blob.announceQueue = (blob.announceQueue||[]).filter(x => x !== id);
    writeLocal(blob);
    return { event: ev };
  }

  // ---- competitors ----
  function localAddCompetitor(eventId, name) {
    const blob = readLocal();
    const ev = blob.events.find(e => e.id === eventId);
    if (!ev) { const err = new Error("not_found"); err.code = 404; throw err; }
    const c = { id: uid(), name, attempts: Array(ev.attempts||1).fill(null) };
    ev.competitors.push(c);
    writeLocal(blob);
    return { competitor: c };
  }
  function localUpdateCompetitor(eventId, cid, patch) {
    const blob = readLocal();
    const ev = blob.events.find(e => e.id === eventId);
    const c = ev?.competitors.find(c => c.id === cid);
    if (!c) { const err = new Error("not_found"); err.code = 404; throw err; }
    Object.assign(c, patch);
    writeLocal(blob);
    return { competitor: c };
  }
  function localDeleteCompetitor(eventId, cid) {
    const blob = readLocal();
    const ev = blob.events.find(e => e.id === eventId);
    if (ev) ev.competitors = ev.competitors.filter(c => c.id !== cid);
    writeLocal(blob);
    return { ok: true };
  }
  function localSetAttempt(eventId, cid, idx, value) {
    const blob = readLocal();
    const ev = blob.events.find(e => e.id === eventId);
    const c = ev?.competitors.find(c => c.id === cid);
    if (!c) { const err = new Error("not_found"); err.code = 404; throw err; }
    while (c.attempts.length <= idx) c.attempts.push(null);
    c.attempts[idx] = value;
    writeLocal(blob);
    return { competitor: c };
  }

  // ---- school ----
  function localUpdateSchool(patch) {
    const blob = readLocal();
    const session = readSession() || {};
    const s = blob.schools.find(s => s.id === session.schoolId);
    if (!s) { const err = new Error("not_found"); err.code = 404; throw err; }
    Object.assign(s, patch);
    writeLocal(blob);
    return { school: s };
  }

  // ---- archives ----
  function localArchiveSeason(label) {
    const blob = readLocal();
    const session = readSession() || {};
    const school = blob.schools.find(s => s.id === session.schoolId);
    if (!school) { const err = new Error("not_found"); err.code = 404; throw err; }
    if (!school.archives) school.archives = [];
    const myEvents = blob.events.filter(e => e.schoolId === school.id);
    const archive = {
      id: uid(),
      label,
      archivedAt: Date.now(),
      events: myEvents.map(e => JSON.parse(JSON.stringify(e))),
      announceQueue: (blob.announceQueue||[]).filter(id => myEvents.some(e => e.id === id))
    };
    school.archives.push(archive);
    const archivedIds = new Set(myEvents.map(e => e.id));
    blob.events = blob.events.filter(e => !archivedIds.has(e.id));
    blob.announceQueue = (blob.announceQueue||[]).filter(id => !archivedIds.has(id));
    writeLocal(blob);
    return { archive };
  }
  function localRestoreArchive(archiveId) {
    const blob = readLocal();
    const session = readSession() || {};
    const school = blob.schools.find(s => s.id === session.schoolId);
    if (!school) { const err = new Error("not_found"); err.code = 404; throw err; }
    const archive = (school.archives||[]).find(a => a.id === archiveId);
    if (!archive) { const err = new Error("not_found"); err.code = 404; throw err; }
    const liveIds = new Set(blob.events.map(e => e.id));
    archive.events.forEach(ev => {
      const restored = JSON.parse(JSON.stringify(ev));
      if (liveIds.has(restored.id)) restored.id = uid();
      blob.events.push(restored);
      liveIds.add(restored.id);
    });
    (archive.announceQueue||[]).forEach(id => {
      if (blob.events.some(e => e.id === id) && !blob.announceQueue.includes(id)) blob.announceQueue.push(id);
    });
    school.archives = school.archives.filter(a => a.id !== archiveId);
    writeLocal(blob);
    return { archive, eventsRestored: archive.events.length };
  }
  function localDeleteArchive(archiveId) {
    const blob = readLocal();
    const session = readSession() || {};
    const school = blob.schools.find(s => s.id === session.schoolId);
    if (!school) { const err = new Error("not_found"); err.code = 404; throw err; }
    school.archives = (school.archives||[]).filter(a => a.id !== archiveId);
    writeLocal(blob);
    return { ok: true };
  }

  // ---- announcer ----
  function localMarkAnnounced(eventId) {
    const blob = readLocal();
    blob.announceQueue = (blob.announceQueue||[]).filter(id => id !== eventId);
    const ev = blob.events.find(e => e.id === eventId);
    if (ev) ev.announcedAt = Date.now();
    writeLocal(blob);
    return { ok: true };
  }
  function localSkipAnnounce(eventId) {
    const blob = readLocal();
    if ((blob.announceQueue||[]).includes(eventId)) {
      blob.announceQueue = blob.announceQueue.filter(id => id !== eventId);
      blob.announceQueue.push(eventId);
      writeLocal(blob);
    }
    return { ok: true };
  }

  // ---- multi-admin: join an existing school by code ----
  function localJoinSchoolAsAdmin(schoolCode) {
    const blob = readLocal();
    const session = readSession() || {};
    const school = (blob.schools||[]).find(s => s.code === schoolCode);
    if (!school) { const err = new Error("school_not_found"); err.code = 404; throw err; }
    if (!school.adminEmails) school.adminEmails = school.adminEmail ? [school.adminEmail] : [];
    if (!school.adminEmails.includes(session.email)) school.adminEmails.push(session.email);
    writeLocal(blob);
    writeSession({ ...session, schoolId: school.id });
    return { school: { id: school.id, name: school.name, code: school.code, masterAdminEmail: school.masterAdminEmail, adminEmails: school.adminEmails } };
  }

  // ---- school code change (master-only with email confirmation) ----
  function localRequestSchoolCodeChange() {
    const blob = readLocal();
    const session = readSession() || {};
    const school = blob.schools.find(s => s.id === session.schoolId);
    if (!school) { const err = new Error("not_found"); err.code = 404; throw err; }
    const code = String(Math.floor(100000 + Math.random()*900000));
    school._pendingCodeChange = { code, ts: Date.now() };
    writeLocal(blob);
    // In remote mode the server emails the master; locally we just expose it on screen.
    return { confirmationSent: false, devConfirmationCode: code, masterAdminEmail: school.masterAdminEmail };
  }
  function localConfirmSchoolCodeChange(newCode, confirmationCode) {
    const blob = readLocal();
    const session = readSession() || {};
    const school = blob.schools.find(s => s.id === session.schoolId);
    if (!school) { const err = new Error("not_found"); err.code = 404; throw err; }
    const pc = school._pendingCodeChange;
    if (!pc || pc.code !== confirmationCode) { const err = new Error("bad_confirmation"); err.code = 401; throw err; }
    const cleaned = String(newCode||"").toUpperCase().replace(/[^A-Z0-9]/g,"");
    if (cleaned.length < 3) { const err = new Error("bad_code"); err.code = 400; throw err; }
    if ((blob.schools||[]).some(s => s.id !== school.id && s.code === cleaned)) {
      const err = new Error("code_taken"); err.code = 409; throw err;
    }
    school.code = cleaned;
    delete school._pendingCodeChange;
    writeLocal(blob);
    return { school: { id: school.id, name: school.name, code: school.code, masterAdminEmail: school.masterAdminEmail, adminEmails: school.adminEmails } };
  }
  function localInviteAdmin(email) {
    // Local mode just returns success — actual emailing requires the backend.
    return { sent: false, devNote: `In remote mode, an invite would be sent to ${email}` };
  }

  // ---- records ----
  function findSchool(blob) {
    const session = readSession() || {};
    return blob.schools.find(s => s.id === session.schoolId);
  }
  function localCreateRecord(record) {
    const blob = readLocal();
    const school = findSchool(blob);
    if (!school) { const err = new Error("not_found"); err.code = 404; throw err; }
    if (!school.records) school.records = [];
    const r = { id: uid(), createdAt: Date.now(), ...record };
    school.records.push(r);
    writeLocal(blob);
    return { record: r };
  }
  function localUpdateRecord(id, patch) {
    const blob = readLocal();
    const school = findSchool(blob);
    const r = (school?.records||[]).find(r => r.id === id);
    if (!r) { const err = new Error("not_found"); err.code = 404; throw err; }
    Object.assign(r, patch);
    writeLocal(blob);
    return { record: r };
  }
  function localDeleteRecord(id) {
    const blob = readLocal();
    const school = findSchool(blob);
    if (school) school.records = (school.records||[]).filter(r => r.id !== id);
    writeLocal(blob);
    return { ok: true };
  }

  // ---- standards ----
  function localCreateStandard(s) {
    const blob = readLocal();
    const school = findSchool(blob);
    if (!school) { const err = new Error("not_found"); err.code = 404; throw err; }
    if (!school.standards) school.standards = [];
    const std = { id: uid(), ...s };
    school.standards.push(std);
    writeLocal(blob);
    return { standard: std };
  }
  function localUpdateStandard(id, patch) {
    const blob = readLocal();
    const school = findSchool(blob);
    const std = (school?.standards||[]).find(s => s.id === id);
    if (!std) { const err = new Error("not_found"); err.code = 404; throw err; }
    Object.assign(std, patch);
    writeLocal(blob);
    return { standard: std };
  }
  function localDeleteStandard(id) {
    const blob = readLocal();
    const school = findSchool(blob);
    if (school) school.standards = (school.standards||[]).filter(s => s.id !== id);
    writeLocal(blob);
    return { ok: true };
  }

  // expose globally
  window.FieldDayAPI = FieldDayAPI;
})();
