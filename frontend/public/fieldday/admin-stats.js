/**
 * Curriculate — Field Day admin stats widget
 *
 * Drop into your /admin page to render a Field Day usage dashboard.
 *
 *   <script src="/fieldday/admin-stats.js" defer></script>
 *   <div id="fieldday-stats"></div>
 *
 * The widget mounts itself into <div id="fieldday-stats"></div> if it
 * exists, or you can call `CurriculateFieldDayStats.mount(el)` manually.
 *
 *   <script>
 *     CurriculateFieldDayStats.mount(
 *       document.getElementById("my-container"),
 *       { endpoint: "/admin/api/fieldday/stats" }   // override if mounted elsewhere
 *     );
 *   </script>
 *
 * Endpoint default: /admin/api/fieldday/stats — adjust to wherever you've
 * mounted the admin-stats router behind your admin auth middleware.
 *
 * The widget:
 *   - Fetches once on mount + once every 60s
 *   - Renders KPIs, top-schools table, recent activity feed
 *   - Self-contained CSS scoped under `.cur-fd-stats-*`
 *   - No external dependencies
 */
(function () {
  "use strict";
  if (window.CurriculateFieldDayStats) return;

  const STYLES = `
  .cur-fd-stats {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif;
    color: #1a1f36;
    --fd-line: #e6e8ef;
    --fd-muted: #5b6477;
    --fd-primary: #2956ff;
  }
  .cur-fd-stats * { box-sizing: border-box; }
  .cur-fd-stats h2 { font-size: 18px; margin: 0 0 12px; }
  .cur-fd-stats h3 { font-size: 13px; margin: 0 0 8px; color: var(--fd-muted); text-transform: uppercase; letter-spacing: .04em; font-weight: 600; }
  .cur-fd-stats-loading { color: var(--fd-muted); padding: 16px; text-align: center; }
  .cur-fd-stats-error { color: #d92d20; padding: 16px; }

  .cur-fd-kpis {
    display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px;
    margin-bottom: 16px;
  }
  @media (max-width: 720px) { .cur-fd-kpis { grid-template-columns: repeat(2, 1fr); } }
  .cur-fd-kpi {
    background: white; border: 1px solid var(--fd-line); border-radius: 10px;
    padding: 12px;
  }
  .cur-fd-kpi .num {
    font-size: 26px; font-weight: 800; color: var(--fd-primary);
    font-variant-numeric: tabular-nums;
  }
  .cur-fd-kpi .lbl { font-size: 12px; color: var(--fd-muted); }
  .cur-fd-kpi .sub { font-size: 11px; color: var(--fd-muted); margin-top: 2px; }

  .cur-fd-stats-grid {
    display: grid; grid-template-columns: 1.2fr 1fr; gap: 14px;
  }
  @media (max-width: 800px) { .cur-fd-stats-grid { grid-template-columns: 1fr; } }
  .cur-fd-card {
    background: white; border: 1px solid var(--fd-line); border-radius: 10px;
    padding: 14px;
  }

  .cur-fd-stats table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .cur-fd-stats th, .cur-fd-stats td { padding: 6px 8px; text-align: left; border-bottom: 1px solid #f1f3f7; }
  .cur-fd-stats th { color: var(--fd-muted); font-weight: 600; font-size: 11px; text-transform: uppercase; }
  .cur-fd-stats td.num { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }

  .cur-fd-feed { display: flex; flex-direction: column; gap: 6px; max-height: 320px; overflow-y: auto; }
  .cur-fd-feed-item {
    display: flex; gap: 8px; align-items: baseline; padding: 6px 8px;
    border-bottom: 1px solid #f1f3f7; font-size: 13px;
  }
  .cur-fd-feed-item:last-child { border-bottom: 0; }
  .cur-fd-feed-time { color: var(--fd-muted); font-size: 11px; min-width: 80px; }

  .cur-fd-foot {
    display: flex; justify-content: space-between; align-items: center;
    margin-top: 12px; font-size: 11px; color: var(--fd-muted);
  }
  .cur-fd-refresh {
    background: transparent; border: 1px solid var(--fd-line); padding: 4px 10px;
    border-radius: 6px; cursor: pointer; font-size: 11px; color: var(--fd-muted);
  }
  .cur-fd-refresh:hover { background: #f7f8fc; color: var(--fd-primary); }
  `;

  function ensureStyles() {
    if (document.getElementById("cur-fd-stats-styles")) return;
    const s = document.createElement("style");
    s.id = "cur-fd-stats-styles";
    s.textContent = STYLES;
    document.head.appendChild(s);
  }

  function escapeHtml(str) {
    return String(str ?? "").replace(/[&<>"']/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }
  function fmtNumber(n) { return Number(n || 0).toLocaleString(); }
  function fmtTime(ts) {
    if (!ts) return "";
    const diff = Date.now() - Number(ts);
    if (diff < 60_000) return "just now";
    if (diff < 3_600_000) return Math.floor(diff / 60_000) + "m ago";
    if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + "h ago";
    return Math.floor(diff / 86_400_000) + "d ago";
  }

  function render(container, data) {
    const s = data.schools || {};
    const e = data.events || {};
    const c = data.competitors || {};
    const r = data.records || {};
    container.innerHTML = `
      <h2>Field Day usage</h2>
      <div class="cur-fd-kpis">
        <div class="cur-fd-kpi">
          <div class="num">${fmtNumber(s.total)}</div>
          <div class="lbl">Schools</div>
          <div class="sub">${fmtNumber(s.withEvents)} active · ${fmtNumber(s.newThisMonth)} new this month</div>
        </div>
        <div class="cur-fd-kpi">
          <div class="num">${fmtNumber(e.total)}</div>
          <div class="lbl">Events</div>
          <div class="sub">${fmtNumber(e.completed)} done · ${fmtNumber(e.inProgress)} live · ${fmtNumber(e.newThisWeek)} this week</div>
        </div>
        <div class="cur-fd-kpi">
          <div class="num">${fmtNumber(c.uniqueByName)}</div>
          <div class="lbl">Unique competitors</div>
          <div class="sub">${fmtNumber(c.totalEntries)} total entries</div>
        </div>
        <div class="cur-fd-kpi">
          <div class="num">${fmtNumber(r.total)}</div>
          <div class="lbl">School records</div>
          <div class="sub">${fmtNumber(r.newThisMonth)} new this month · ${fmtNumber(s.withHouses)} schools w/ houses</div>
        </div>
      </div>

      <div class="cur-fd-stats-grid">
        <div class="cur-fd-card">
          <h3>Top schools by competitor count</h3>
          ${(data.topSchools || []).length === 0 ? `<div style="color:var(--fd-muted);font-size:13px">No data yet.</div>` : `
          <table>
            <thead><tr><th>School</th><th>Code</th><th class="num">Events</th><th class="num">Competitors</th></tr></thead>
            <tbody>
              ${data.topSchools.map(t => `
                <tr>
                  <td>${escapeHtml(t.name)}</td>
                  <td><code>${escapeHtml(t.code || "")}</code></td>
                  <td class="num">${fmtNumber(t.events)}</td>
                  <td class="num">${fmtNumber(t.competitors)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
          `}
        </div>

        <div class="cur-fd-card">
          <h3>Recent completed events</h3>
          <div class="cur-fd-feed">
            ${(data.recentActivity || []).length === 0 ? `<div style="color:var(--fd-muted);font-size:13px">No recent activity.</div>` : data.recentActivity.map(a => `
              <div class="cur-fd-feed-item">
                <span class="cur-fd-feed-time">${escapeHtml(fmtTime(a.ts))}</span>
                <span><strong>${escapeHtml(a.title)}</strong> — Age ${escapeHtml(a.age)} ${escapeHtml(a.gender)}<br><span style="color:var(--fd-muted);font-size:11px">${escapeHtml(a.schoolName)} <code>${escapeHtml(a.schoolCode)}</code></span></span>
              </div>
            `).join("")}
          </div>
        </div>
      </div>

      <div class="cur-fd-foot">
        <span>Data fresh as of ${escapeHtml(new Date(data.generatedAt).toLocaleTimeString())}.</span>
        <button class="cur-fd-refresh" data-refresh>Refresh now</button>
      </div>
    `;
    container.querySelector("[data-refresh]")?.addEventListener("click", () => fetchAndRender(container, container._fdEndpoint));
  }

  async function fetchAndRender(container, endpoint) {
    container.innerHTML = `<div class="cur-fd-stats-loading">Loading Field Day stats…</div>`;
    try {
      const res = await fetch(endpoint, { credentials: "same-origin" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      render(container, data);
    } catch (e) {
      container.innerHTML = `<div class="cur-fd-stats-error">Couldn't load stats: ${escapeHtml(e.message || e)}</div>`;
    }
  }

  function mount(el, opts) {
    if (!el) return;
    ensureStyles();
    el.classList.add("cur-fd-stats");
    el._fdEndpoint = (opts && opts.endpoint) || "/admin/api/fieldday/stats";
    fetchAndRender(el, el._fdEndpoint);
    // Auto-refresh every 60s
    if (el._fdInterval) clearInterval(el._fdInterval);
    el._fdInterval = setInterval(() => fetchAndRender(el, el._fdEndpoint), 60_000);
  }

  function autoMount() {
    const el = document.getElementById("fieldday-stats");
    if (el) mount(el);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", autoMount);
  else autoMount();

  window.CurriculateFieldDayStats = { mount, fetchAndRender };
})();
