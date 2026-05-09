// frontend/public/fieldday/feedback-button.js
//
// Field Day — bug reports + suggestions UI (vanilla JS, no framework).
// Mirrors the Pulse Grading PulseFeedbackButton.jsx design:
//   - floating button bottom-left
//   - modal with two kind buttons, then a textarea + optional contact
//   - POST to /fieldday/api/report (rate-limited to 10/10min/IP, auth-free)
//
// Loaded as a regular <script> from index.html. No build step required.

(function () {
  "use strict";

  // ----- config -----
  // Same heuristic as the rest of the FieldDay app for the API base URL —
  // local dev hits localhost:10000, production hits api.curriculate.net.
  function getBackendBase() {
    if (typeof window === "undefined") return "https://api.curriculate.net";
    if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
      return "http://localhost:10000";
    }
    return "https://api.curriculate.net";
  }
  var API_BASE = getBackendBase();

  // ----- styles (one-time injection) -----
  function injectStyles() {
    if (document.getElementById("fd-feedback-styles")) return;
    var s = document.createElement("style");
    s.id = "fd-feedback-styles";
    s.textContent = [
      ".fd-feedback-fab{position:fixed;left:16px;bottom:16px;z-index:9000;width:48px;height:48px;border-radius:50%;border:none;",
      "background:linear-gradient(135deg,#fbbf24,#f59e0b);color:#1f2937;font-size:22px;font-weight:800;cursor:pointer;",
      "box-shadow:0 6px 18px rgba(0,0,0,0.18);}",
      ".fd-feedback-overlay{position:fixed;inset:0;background:rgba(15,23,42,0.45);backdrop-filter:blur(2px);z-index:10000;",
      "display:flex;align-items:center;justify-content:center;padding:16px;}",
      ".fd-feedback-modal{width:100%;max-width:460px;border-radius:16px;background:#fff;box-shadow:0 20px 50px rgba(0,0,0,0.25);padding:20px;",
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;}",
      ".fd-feedback-modal h3{margin:0;font-size:17px;font-weight:800;}",
      ".fd-feedback-close{background:transparent;border:none;font-size:22px;color:#64748b;cursor:pointer;line-height:1;padding:4px;}",
      ".fd-feedback-kind-btn{display:flex;align-items:center;gap:14px;padding:12px 14px;border:1px solid;border-radius:12px;cursor:pointer;",
      "text-align:left;width:100%;background:transparent;font-family:inherit;}",
      ".fd-feedback-kind-btn .t{font-weight:800;font-size:14px;color:#0f172a;}",
      ".fd-feedback-kind-btn .s{font-size:12px;color:#475569;margin-top:2px;}",
      ".fd-feedback-textarea{width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:10px;font-size:14px;",
      "font-family:inherit;resize:vertical;min-height:100px;box-sizing:border-box;}",
      ".fd-feedback-input{padding:8px 10px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;font-family:inherit;box-sizing:border-box;}",
      ".fd-feedback-primary{padding:8px 18px;border:none;border-radius:10px;color:#fff;font-weight:800;font-size:14px;cursor:pointer;}",
      ".fd-feedback-ghost{padding:8px 14px;border:1px solid #e2e8f0;border-radius:10px;background:transparent;color:#475569;",
      "font-weight:700;font-size:13px;cursor:pointer;}",
      ".fd-feedback-error{color:#b91c1c;font-size:12px;margin-top:8px;}",
    ].join("");
    document.head.appendChild(s);
  }

  // ----- modal state -----
  var state = {
    kind: null,        // "problem" | "suggestion"
    sending: false,
    sent: false,
  };

  function getEl(id) { return document.getElementById(id); }
  function setBtnEnabled(btn, enabled) {
    if (!btn) return;
    btn.disabled = !enabled;
    btn.style.opacity = enabled ? "1" : "0.55";
    btn.style.cursor = enabled ? "pointer" : "not-allowed";
  }

  function close() {
    var ov = getEl("fd-feedback-overlay");
    if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
    state = { kind: null, sending: false, sent: false };
  }

  function renderThanks() {
    var modal = getEl("fd-feedback-modal-body");
    if (!modal) return;
    modal.innerHTML = [
      '<div style="text-align:center;padding:24px 12px;">',
      '<div style="font-size:36px;">🙏</div>',
      '<div style="font-weight:800;font-size:18px;margin-top:8px;">Thanks — got it.</div>',
      '<div style="color:#475569;font-size:13px;margin-top:4px;">This goes straight to the team\'s triage queue.</div>',
      "</div>",
    ].join("");
    setTimeout(close, 2500);
  }

  function renderForm(kind) {
    state.kind = kind;
    var modal = getEl("fd-feedback-modal-body");
    if (!modal) return;
    var icon = kind === "problem" ? "🐞" : "💡";
    var label = kind === "problem" ? "Report a problem" : "Suggest a feature";
    var ph = kind === "problem"
      ? "What were you doing when it broke? What did you see vs. expect?"
      : "What would help your workflow? Example uses welcome.";
    var primaryBg = kind === "problem"
      ? "linear-gradient(135deg,#f59e0b,#ef4444)"
      : "linear-gradient(135deg,#2563eb,#7c3aed)";

    var savedEmail = "";
    try { savedEmail = localStorage.getItem("fd_feedback_email") || ""; } catch (_) {}
    var savedName = "";
    try { savedName = localStorage.getItem("fd_feedback_name") || ""; } catch (_) {}

    modal.innerHTML = [
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">',
      '  <h3>Send feedback to the team</h3>',
      '  <button type="button" class="fd-feedback-close" id="fd-feedback-close-x" aria-label="Close">×</button>',
      '</div>',
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">',
      '  <span style="font-size:18px;">' + icon + '</span>',
      '  <span style="font-weight:700;font-size:14px;color:#0f172a;">' + label + '</span>',
      '  <button type="button" id="fd-feedback-change" style="margin-left:auto;background:transparent;border:none;color:#64748b;font-size:12px;font-weight:700;cursor:pointer;">change</button>',
      '</div>',
      '<textarea id="fd-feedback-msg" class="fd-feedback-textarea" rows="5" placeholder="' + ph + '" autofocus></textarea>',
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px;">',
      '  <input id="fd-feedback-name" class="fd-feedback-input" type="text" placeholder="Your name (optional)" value="' + savedName.replace(/"/g, "&quot;") + '" />',
      '  <input id="fd-feedback-email" class="fd-feedback-input" type="email" placeholder="Email (optional, for follow-up)" value="' + savedEmail.replace(/"/g, "&quot;") + '" />',
      '</div>',
      '<div id="fd-feedback-err" class="fd-feedback-error" style="display:none;"></div>',
      '<div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end;">',
      '  <button type="button" id="fd-feedback-cancel" class="fd-feedback-ghost">Cancel</button>',
      '  <button type="button" id="fd-feedback-submit" class="fd-feedback-primary" style="background:' + primaryBg + ';" disabled>Send</button>',
      '</div>',
    ].join("");

    var msg = getEl("fd-feedback-msg");
    var sub = getEl("fd-feedback-submit");
    msg.addEventListener("input", function () {
      setBtnEnabled(sub, msg.value.trim().length >= 5 && !state.sending);
    });
    setBtnEnabled(sub, false);

    getEl("fd-feedback-close-x").addEventListener("click", close);
    getEl("fd-feedback-cancel").addEventListener("click", close);
    getEl("fd-feedback-change").addEventListener("click", function () { renderKindPicker(); });
    sub.addEventListener("click", submit);
  }

  function renderKindPicker() {
    state.kind = null;
    var modal = getEl("fd-feedback-modal-body");
    if (!modal) return;
    modal.innerHTML = [
      '<div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:8px;">',
      '  <h3>Send feedback to the team</h3>',
      '  <button type="button" class="fd-feedback-close" id="fd-feedback-close-x2" aria-label="Close">×</button>',
      '</div>',
      '<p style="margin:4px 0 14px;color:#475569;font-size:13px;">Quick triage — what brings you here?</p>',
      '<div style="display:grid;gap:10px;">',
      '  <button type="button" class="fd-feedback-kind-btn" id="fd-kind-problem" style="background:linear-gradient(135deg,#fee2e2,#fef3c7);border-color:#fbbf24;">',
      '    <div style="font-size:22px;">🐞</div>',
      '    <div><div class="t">Report a problem</div><div class="s">Something\'s broken, slow, or wrong.</div></div>',
      '  </button>',
      '  <button type="button" class="fd-feedback-kind-btn" id="fd-kind-suggestion" style="background:linear-gradient(135deg,#dcfce7,#dbeafe);border-color:#60a5fa;">',
      '    <div style="font-size:22px;">💡</div>',
      '    <div><div class="t">Suggest a feature</div><div class="s">An idea that would make Field Day better.</div></div>',
      '  </button>',
      '</div>',
    ].join("");
    getEl("fd-feedback-close-x2").addEventListener("click", close);
    getEl("fd-kind-problem").addEventListener("click", function () { renderForm("problem"); });
    getEl("fd-kind-suggestion").addEventListener("click", function () { renderForm("suggestion"); });
  }

  function submit() {
    if (state.sending) return;
    var msg = getEl("fd-feedback-msg");
    var nameEl = getEl("fd-feedback-name");
    var emailEl = getEl("fd-feedback-email");
    var sub = getEl("fd-feedback-submit");
    var errEl = getEl("fd-feedback-err");
    var message = (msg.value || "").trim();
    if (message.length < 5) {
      errEl.textContent = "Add a few words so we know what's going on.";
      errEl.style.display = "block";
      return;
    }
    var name = (nameEl.value || "").trim();
    var email = (emailEl.value || "").trim().toLowerCase();
    try {
      if (name) localStorage.setItem("fd_feedback_name", name);
      if (email) localStorage.setItem("fd_feedback_email", email);
    } catch (_) {}

    state.sending = true;
    setBtnEnabled(sub, false);
    sub.textContent = "Sending…";
    errEl.style.display = "none";

    var body = JSON.stringify({
      kind: state.kind,
      message: message,
      fromName: name,
      fromEmail: email,
      surface: "fieldday",
      context: {
        url: window.location.href,
        viewport: window.innerWidth + "x" + window.innerHeight,
        userAgent: navigator.userAgent || "",
      },
    });

    fetch(API_BASE + "/fieldday/api/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body,
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok) {
            var msg2 = res.status === 429
              ? "Too many reports right now — please try again in a few minutes."
              : (data && data.error) || ("Send failed (" + res.status + ")");
            throw new Error(msg2);
          }
          return data;
        });
      })
      .then(function () {
        state.sent = true;
        renderThanks();
      })
      .catch(function (e) {
        state.sending = false;
        sub.textContent = "Send";
        setBtnEnabled(sub, msg.value.trim().length >= 5);
        errEl.textContent = e.message || "Send failed.";
        errEl.style.display = "block";
      });
  }

  function openModal() {
    if (getEl("fd-feedback-overlay")) return; // already open
    var ov = document.createElement("div");
    ov.id = "fd-feedback-overlay";
    ov.className = "fd-feedback-overlay";
    ov.addEventListener("click", function (e) { if (e.target === ov) close(); });

    var modal = document.createElement("div");
    modal.className = "fd-feedback-modal";
    modal.id = "fd-feedback-modal-body";
    ov.appendChild(modal);
    document.body.appendChild(ov);

    renderKindPicker();
  }

  function mount() {
    injectStyles();
    if (getEl("fd-feedback-fab")) return;
    var btn = document.createElement("button");
    btn.id = "fd-feedback-fab";
    btn.className = "fd-feedback-fab";
    btn.title = "Report a problem or suggest a feature";
    btn.setAttribute("aria-label", "Report a problem or suggest a feature");
    btn.textContent = "💬";
    btn.addEventListener("click", openModal);
    document.body.appendChild(btn);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
