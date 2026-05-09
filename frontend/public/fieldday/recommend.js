/**
 * Curriculate — Recommend widget
 *
 * Drop-in script for any page on curriculate.net (e.g. /admin) that wants
 * to let the logged-in user recommend Curriculate / Grading / Field Day to
 * a teacher at another school.
 *
 * Usage:
 *
 *   <script src="/fieldday/recommend.js" defer></script>
 *
 *   <button onclick="CurriculateRecommend.open()">Recommend Curriculate</button>
 *
 *   // Or auto-attach to any element with the data attribute:
 *   <button data-curriculate-recommend>Recommend Curriculate</button>
 *
 *   // Pre-fill sender info when known:
 *   CurriculateRecommend.open({ senderName: "Richard Sommer", senderSchool: "Maple Elementary" });
 *
 * The widget self-contains its CSS in a single <style> tag scoped under
 * `.cur-recommend-modal`, so it won't conflict with the host page's styles.
 *
 * Backend dependency: POST /fieldday/api/refer — already implemented in
 * backend/fieldday/routes/refer.js. The widget hits the same-origin
 * endpoint, so no CORS work needed.
 */
(function () {
  "use strict";
  if (window.CurriculateRecommend) return; // idempotent

  const ENDPOINT = "/fieldday/api/refer";

  const STYLES = `
  .cur-recommend-modal {
    position: fixed; inset: 0; z-index: 9999;
    background: rgba(20, 24, 42, .55);
    display: flex; align-items: center; justify-content: center;
    padding: 16px;
    backdrop-filter: blur(4px);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, "Helvetica Neue", Arial, sans-serif;
  }
  .cur-recommend-card {
    background: white; border-radius: 14px; max-width: 560px; width: 100%;
    max-height: 90vh; overflow: hidden;
    display: flex; flex-direction: column;
    box-shadow: 0 24px 60px rgba(16,24,40,.18);
  }
  .cur-recommend-card header {
    padding: 14px 18px; border-bottom: 1px solid #e6e8ef;
    display: flex; align-items: center; justify-content: space-between;
  }
  .cur-recommend-card h2 { font-size: 18px; margin: 0; color: #1a1f36; }
  .cur-recommend-card .cur-x {
    border: 0; background: transparent; font-size: 20px; cursor: pointer;
    color: #6b7280; width: 32px; height: 32px; border-radius: 6px;
  }
  .cur-recommend-card .cur-x:hover { background: #eef0f5; color: #1a1f36; }
  .cur-recommend-body { padding: 18px; overflow: auto; }
  .cur-recommend-body p { margin: 0 0 10px; color: #5b6477; font-size: 13px; }
  .cur-recommend-row { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
  .cur-recommend-row > label { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: #6b7280; font-weight: 600; }
  .cur-recommend-row.split { flex-direction: row; gap: 10px; }
  .cur-recommend-row.split > div { flex: 1; display: flex; flex-direction: column; gap: 6px; }
  .cur-recommend-row input {
    border: 1px solid #e5e7eb; padding: 9px 10px; border-radius: 8px;
    font-size: 15px; background: white; font-family: inherit;
  }
  .cur-recommend-checks { display: flex; flex-direction: column; gap: 8px; }
  .cur-recommend-check {
    display: flex; gap: 10px; align-items: flex-start;
    border: 1px solid #e5e7eb; padding: 10px 12px; border-radius: 8px;
    cursor: pointer;
  }
  .cur-recommend-check input { margin-top: 2px; flex: 0 0 auto; }
  .cur-recommend-check strong { color: #1a1f36; display: block; }
  .cur-recommend-check span { color: #5b6477; font-size: 13px; }
  .cur-recommend-check:has(input:checked) {
    border-color: #2956ff; background: #f4f7ff;
  }
  .cur-recommend-card footer {
    padding: 12px 18px; border-top: 1px solid #e6e8ef;
    display: flex; justify-content: flex-end; gap: 8px;
  }
  .cur-recommend-card footer button {
    font-family: inherit; font-size: 14px; font-weight: 500;
    padding: 9px 14px; border-radius: 8px; cursor: pointer;
  }
  .cur-recommend-cancel {
    background: transparent; border: 1px solid #e5e7eb; color: #1a1f36;
  }
  .cur-recommend-send {
    background: #2956ff; border: 1px solid #2956ff; color: white;
  }
  .cur-recommend-send:disabled { opacity: .6; cursor: not-allowed; }
  .cur-recommend-toast {
    position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
    background: #1a1f36; color: white; padding: 10px 18px; border-radius: 999px;
    font-size: 14px; z-index: 10000;
  }
  `;

  function ensureStyles() {
    if (document.getElementById("cur-recommend-styles")) return;
    const s = document.createElement("style");
    s.id = "cur-recommend-styles";
    s.textContent = STYLES;
    document.head.appendChild(s);
  }

  function escapeHtml(str) {
    return String(str ?? "").replace(/[&<>"']/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  function toast(msg, ms = 2400) {
    const el = document.createElement("div");
    el.className = "cur-recommend-toast";
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  function open(prefill) {
    ensureStyles();
    prefill = prefill || {};

    const overlay = document.createElement("div");
    overlay.className = "cur-recommend-modal";
    overlay.innerHTML = `
      <div class="cur-recommend-card" role="dialog" aria-labelledby="curRecHeading">
        <header>
          <h2 id="curRecHeading">Recommend Curriculate to a teacher</h2>
          <button class="cur-x" aria-label="Close">✕</button>
        </header>
        <div class="cur-recommend-body">
          <p>We'll send a single email from <strong>Curriculate</strong> describing the products you select. No mailing list, no follow-ups.</p>

          <div class="cur-recommend-row">
            <label>Recommend</label>
            <div class="cur-recommend-checks">
              <label class="cur-recommend-check">
                <input type="checkbox" name="curRecProduct" value="curriculate" />
                <span><strong>Curriculate</strong>The platform overall — for context.</span>
              </label>
              <label class="cur-recommend-check">
                <input type="checkbox" name="curRecProduct" value="grading" />
                <span><strong>Curriculate Grading</strong>AI-assisted grading for teachers.</span>
              </label>
              <label class="cur-recommend-check">
                <input type="checkbox" name="curRecProduct" value="fieldday" checked />
                <span><strong>Curriculate Field Day</strong>The free school field day app.</span>
              </label>
            </div>
          </div>

          <div class="cur-recommend-row">
            <label>Their name</label>
            <input name="teacherName" placeholder="Jane Doe" />
          </div>
          <div class="cur-recommend-row">
            <label>Their email</label>
            <input name="teacherEmail" type="email" placeholder="jane@otherschool.org" />
          </div>
          <div class="cur-recommend-row">
            <label>Their school (optional)</label>
            <input name="schoolName" placeholder="e.g. Oakwood Primary" />
          </div>
          <div class="cur-recommend-row split">
            <div>
              <label>Your name</label>
              <input name="senderName" value="${escapeHtml(prefill.senderName || "")}" placeholder="Your name" />
            </div>
            <div>
              <label>Your school (optional)</label>
              <input name="senderSchool" value="${escapeHtml(prefill.senderSchool || "")}" placeholder="e.g. Maple Elementary" />
            </div>
          </div>
        </div>
        <footer>
          <button type="button" class="cur-recommend-cancel">Cancel</button>
          <button type="button" class="cur-recommend-send">Send Recommendation</button>
        </footer>
      </div>
    `;

    function close() { overlay.remove(); }
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    overlay.querySelector(".cur-x").addEventListener("click", close);
    overlay.querySelector(".cur-recommend-cancel").addEventListener("click", close);

    const sendBtn = overlay.querySelector(".cur-recommend-send");
    sendBtn.addEventListener("click", async () => {
      const get = (name) => overlay.querySelector(`[name="${name}"]`).value.trim();
      const products = [...overlay.querySelectorAll("[name='curRecProduct']:checked")].map(cb => cb.value);
      if (products.length === 0) return toast("Pick at least one product");
      const payload = {
        teacherName:  get("teacherName"),
        teacherEmail: get("teacherEmail").toLowerCase(),
        schoolName:   get("schoolName"),
        senderName:   get("senderName"),
        senderSchool: get("senderSchool"),
        products
      };
      if (!payload.teacherName || !payload.teacherEmail || !payload.senderName)
        return toast("Fill in their name, their email, and your name");
      if (!payload.teacherEmail.includes("@"))
        return toast("That doesn't look like a valid email");

      sendBtn.disabled = true; sendBtn.textContent = "Sending…";
      try {
        const res = await fetch(ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error("send_failed");
        const data = await res.json();
        close();
        toast(data?.sent ? `Recommendation sent to ${payload.teacherName}` : "Couldn't send — try again later");
      } catch (e) {
        toast("Couldn't send — try again later");
        sendBtn.disabled = false; sendBtn.textContent = "Send Recommendation";
      }
    });

    document.body.appendChild(overlay);
    setTimeout(() => overlay.querySelector("[name='teacherName']").focus(), 30);
  }

  // Auto-attach to any [data-curriculate-recommend] element on the page.
  function attachAuto() {
    document.querySelectorAll("[data-curriculate-recommend]").forEach(el => {
      if (el._curRecAttached) return;
      el._curRecAttached = true;
      el.addEventListener("click", () => open({
        senderName:   el.dataset.senderName   || "",
        senderSchool: el.dataset.senderSchool || ""
      }));
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", attachAuto);
  else attachAuto();

  window.CurriculateRecommend = { open };
})();
