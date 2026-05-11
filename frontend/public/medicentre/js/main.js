/* MediCentre – shared client-side JS */
(function () {
  // Mobile nav toggle
  document.addEventListener('click', function (e) {
    const t = e.target.closest('[data-nav-toggle]');
    if (t) {
      const nav = document.querySelector('nav.primary');
      if (nav) nav.classList.toggle('open');
    }
    // Generic modal close on backdrop click
    if (e.target.classList && e.target.classList.contains('modal-backdrop')) {
      e.target.classList.remove('open');
    }
    if (e.target.closest('[data-modal-close]')) {
      const m = e.target.closest('.modal-backdrop');
      if (m) m.classList.remove('open');
    }
  });

  // Highlight active nav link based on current path
  const path = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('nav.primary a').forEach(a => {
    const href = a.getAttribute('href');
    if (!href) return;
    if (href === path || (path === '' && href === 'index.html')) {
      a.classList.add('active');
    }
  });

  // Year in footer
  const y = document.querySelector('[data-year]');
  if (y) y.textContent = new Date().getFullYear();

  // Live status (Open / Closed) based on hours
  const status = document.querySelector('[data-clinic-status]');
  if (status) {
    const now = new Date();
    const day = now.getDay(); // 0 Sun .. 6 Sat
    const h = now.getHours() + now.getMinutes() / 60;
    // Actual hours: Mon/Tue/Wed/Fri 9-17, Thu 9-19, Sat 10-14, Sun closed
    let open = false;
    if ((day === 1 || day === 2 || day === 3 || day === 5) && h >= 9 && h < 17) open = true;
    else if (day === 4 && h >= 9 && h < 19) open = true;
    else if (day === 6 && h >= 10 && h < 14) open = true;
    status.innerHTML = open
      ? '<span class="dot"></span> Open now'
      : '<span class="dot" style="background:#B23A48;animation:none;"></span> Closed — opens at next scheduled hour';
    if (!open) status.style.background = '#FBE6E9';
    if (!open) status.style.color = '#7A1F2C';
  }

  // Smooth-scroll for in-page anchors
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', function (e) {
      const id = a.getAttribute('href');
      if (id.length > 1) {
        const el = document.querySelector(id);
        if (el) {
          e.preventDefault();
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    });
  });
})();

/* ---- Tiny local "store" used so the public appointment form and the
       admin dashboard can share data via localStorage on the same site.
       In production this would be replaced by API calls to the backend. ---- */
window.MC = window.MC || {};
MC.store = {
  KEY: 'medicentre.appointments.v1',
  list() {
    try { return JSON.parse(localStorage.getItem(this.KEY)) || []; }
    catch (_) { return []; }
  },
  save(arr) { localStorage.setItem(this.KEY, JSON.stringify(arr)); },
  add(req) {
    const arr = this.list();
    req.id = 'APT-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    req.submittedAt = new Date().toISOString();
    req.status = req.status || 'Pending';
    arr.unshift(req);
    this.save(arr);
    return req;
  },
  update(id, patch) {
    const arr = this.list();
    const i = arr.findIndex(x => x.id === id);
    if (i >= 0) {
      arr[i] = Object.assign({}, arr[i], patch);
      this.save(arr);
      return arr[i];
    }
    return null;
  },
  remove(id) {
    const arr = this.list().filter(x => x.id !== id);
    this.save(arr);
  },
  // Seed is intentionally empty — the admin dashboard starts clean.
  // Real appointment requests submitted through the public form will
  // populate the list. Keeping this method so callers don't error.
  seedIfEmpty() { /* no sample data — real submissions only */ }
};
