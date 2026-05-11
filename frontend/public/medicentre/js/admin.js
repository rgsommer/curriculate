/* MediCentre — Admin Dashboard
 * --------------------------------------------------------------
 * Reads/writes the same local store the public form writes to.
 * In production, this would call /api/appointments etc. instead.
 * The functions confirmAppointment(), declineAppointment(),
 * and rescheduleAppointment() are the integration points where
 * Outlook calendar API calls + outbound emails will be wired in.
 * -------------------------------------------------------------- */

(function () {
  // -------- Auth check --------
  const session = (() => {
    try { return JSON.parse(sessionStorage.getItem('mc.admin')) || null; }
    catch (_) { return null; }
  })();
  if (!session && !location.pathname.endsWith('/index.html')) {
    // Allow navigation back to login
  }

  // Seed sample data if empty (helpful for demo)
  if (MC && MC.store) MC.store.seedIfEmpty();

  // -------- DOM refs --------
  const tbody = document.getElementById('appt-table-body');
  const tabs = document.querySelectorAll('.tabs button');
  const searchEl = document.getElementById('filter-search');
  const docEl = document.getElementById('filter-doctor');
  const catEl = document.getElementById('filter-category');
  const resetBtn = document.getElementById('reset-filters');
  const seedBtn = document.getElementById('seed-btn');
  const clearBtn = document.getElementById('clear-btn');

  // Topbar / signed-in
  const sigEl = document.getElementById('signed-in-as');
  const nameEl = document.getElementById('topbar-name');
  const avEl = document.getElementById('topbar-avatar');
  if (session) {
    sigEl.innerHTML = `Signed in as<br><strong style="color:#fff">${escapeHtml(session.name || session.email)}</strong>`;
    nameEl.textContent = session.name || session.email;
    avEl.textContent = (session.name || session.email).charAt(0).toUpperCase();
  } else {
    sigEl.innerHTML = `<a href="index.html" style="color:#fff;">Sign in</a>`;
  }
  document.getElementById('signout-link')?.addEventListener('click', e => {
    e.preventDefault();
    sessionStorage.removeItem('mc.admin');
    location.href = 'index.html';
  });

  // -------- State --------
  let currentTab = 'all';

  // -------- Render --------
  function render() {
    const all = MC.store.list();
    const filtered = applyFilters(all);

    // KPI updates
    const pending  = all.filter(a => a.status === 'Pending').length;
    const urgent   = all.filter(a => a.visitCategory === 'Urgent' && a.status === 'Pending').length;
    const today    = countToday(all);
    const newPts   = all.filter(a => a.visitCategory === 'New patient' && withinDays(a.submittedAt, 30)).length;
    document.getElementById('kpi-pending').textContent = pending;
    document.getElementById('kpi-urgent').textContent  = urgent;
    document.getElementById('kpi-today').textContent   = today;
    document.getElementById('kpi-newpts').textContent  = newPts;
    document.getElementById('kpi-urgent-delta').innerHTML =
      urgent > 0 ? '<span class="delta-down">⚠ needs triage</span>' : '<span class="delta-up">all clear</span>';

    if (!filtered.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty-state">
        <div style="font-size:1.4rem;margin-bottom:.4rem;">No appointment requests match these filters.</div>
        <div>Try clearing filters, or load sample data using the button above.</div>
      </td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(rowHtml).join('');
    tbody.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => openDetail(b.dataset.view)));
    tbody.querySelectorAll('[data-quickconfirm]').forEach(b => b.addEventListener('click', () => quickConfirm(b.dataset.quickconfirm)));
    tbody.querySelectorAll('[data-decline]').forEach(b => b.addEventListener('click', () => declineAppointment(b.dataset.decline)));
  }

  function applyFilters(arr) {
    const q = searchEl.value.trim().toLowerCase();
    const doc = docEl.value;
    const cat = catEl.value;
    return arr.filter(a => {
      // Tab
      if (currentTab === 'pending'    && a.status !== 'Pending') return false;
      if (currentTab === 'urgent'     && a.visitCategory !== 'Urgent') return false;
      if (currentTab === 'newpatient' && a.visitCategory !== 'New patient') return false;
      if (currentTab === 'scheduled'  && a.status !== 'Scheduled') return false;
      if (currentTab === 'confirmed'  && a.status !== 'Confirmed') return false;
      if (currentTab === 'declined'   && a.status !== 'Declined')  return false;
      // Doctor
      if (doc && (a.preferredDoctor || 'Any available') !== doc) return false;
      // Category
      if (cat && a.visitCategory !== cat) return false;
      // Search
      if (q) {
        const hay = [
          a.id, a.firstName, a.lastName, a.email, a.phone,
          a.bookerName, a.bookerEmail, a.bookerPhone,
          a.symptoms, a.preferredDoctor, a.visitCategory
        ].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function rowHtml(a) {
    const bookerNote = a.bookingFor === 'Other'
      ? ` <span class="badge badge-primary" title="Booked by ${escapeHtml(a.bookerName || 'someone else')} (${escapeHtml(a.bookerRelation || '')})">Booked by ${escapeHtml(a.bookerRelation || 'other')}</span>`
      : '';
    const catBadge = a.visitCategory
      ? `<span class="badge ${categoryClass(a.visitCategory)}">${escapeHtml(a.visitCategory)}</span>`
      : '';
    return `
      <tr>
        <td><code>${a.id}</code></td>
        <td>
          <strong>${escapeHtml(a.firstName + ' ' + a.lastName)}</strong>${bookerNote}<br>
          <small class="text-muted">${escapeHtml(a.email || a.phone || '')}</small>
        </td>
        <td>${catBadge}</td>
        <td>${escapeHtml(a.preferredDoctor || 'Any available')}${doctorFlexibilityNote(a)}</td>
        <td><small>${formatRelative(a.submittedAt)}</small></td>
        <td><span class="badge ${statusClass(a.status)} status-pill">${escapeHtml(a.status)}</span></td>
        <td class="row-actions" style="text-align:right;white-space:nowrap;">
          <button data-view="${a.id}">View</button>
          ${a.status === 'Pending'
            ? `<button class="confirm-btn" data-quickconfirm="${a.id}">Confirm</button>
               <button class="danger-btn" data-decline="${a.id}">Decline</button>`
            : ''}
        </td>
      </tr>
    `;
  }

  function categoryClass(c) {
    if (c === 'Urgent')      return 'badge-danger';
    if (c === 'New patient') return 'badge-accent';
    if (c === 'Follow-up')   return 'badge-primary';
    if (c === 'Routine')     return 'badge-primary';
    return 'badge-primary';
  }
  function statusClass(s) {
    if (s === 'Pending')   return 'badge-warning';
    if (s === 'Scheduled') return 'badge-primary';
    if (s === 'Confirmed') return 'badge-accent';
    if (s === 'Declined')  return 'badge-danger';
    return 'badge-primary';
  }

  function countToday(arr) {
    const today = new Date(); today.setHours(0,0,0,0);
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate()+1);
    return arr.filter(a => {
      if (!a.scheduledAt) return false;
      const d = new Date(a.scheduledAt);
      return d >= today && d < tomorrow;
    }).length;
  }
  function withinDays(iso, days) {
    if (!iso) return false;
    return (Date.now() - new Date(iso).getTime()) < days*24*3600*1000;
  }

  function formatRelative(iso) {
    if (!iso) return '—';
    const ms = Date.now() - new Date(iso).getTime();
    const min = Math.floor(ms / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return min + ' min ago';
    const hr = Math.floor(min / 60);
    if (hr < 24) return hr + ' hr ago';
    const d = Math.floor(hr / 24);
    if (d < 7) return d + ' day' + (d>1?'s':'') + ' ago';
    return new Date(iso).toLocaleDateString();
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
    }[c]));
  }

  // Inline tag describing whether the patient is flexible if their preferred doctor isn't available.
  function doctorFlexibilityNote(a) {
    const d = a.preferredDoctor;
    if (!d || d === 'Any available' || d === 'Walk-in / Urgent') return '';
    return a.flexibleOnDoctor
      ? ' <span class="badge badge-accent" style="font-size:.7rem;margin-left:.3rem;">or any if unavailable</span>'
      : ' <span class="badge badge-warning" style="font-size:.7rem;margin-left:.3rem;">this doctor only</span>';
  }

  // -------- Tabs & filters --------
  tabs.forEach(t => t.addEventListener('click', () => {
    tabs.forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    currentTab = t.dataset.tab;
    render();
  }));

  [searchEl, docEl, catEl].forEach(el => el.addEventListener('input', render));
  resetBtn.addEventListener('click', () => {
    searchEl.value = ''; docEl.value = ''; catEl.value = '';
    tabs.forEach(x => x.classList.remove('active'));
    document.querySelector('.tabs button[data-tab="all"]').classList.add('active');
    currentTab = 'all';
    render();
  });
  seedBtn.addEventListener('click', () => {
    localStorage.removeItem(MC.store.KEY);
    MC.store.seedIfEmpty();
    render();
  });
  clearBtn.addEventListener('click', () => {
    if (!confirm('Clear all appointment requests from this browser?')) return;
    localStorage.removeItem(MC.store.KEY);
    render();
  });

  // -------- Detail modal --------
  const modal     = document.getElementById('detail-modal');
  const detailBody = document.getElementById('detail-body');
  const detailFoot = document.getElementById('detail-foot');
  const detailTitle = document.getElementById('detail-title');

  function openDetail(id) {
    const a = MC.store.list().find(x => x.id === id);
    if (!a) return;
    detailTitle.textContent = `Appointment request · ${a.id}`;
    detailBody.innerHTML = renderDetail(a);
    detailFoot.innerHTML = renderDetailFooter(a);
    modal.classList.add('open');

    detailFoot.querySelectorAll('[data-action]').forEach(b => {
      b.addEventListener('click', () => handleAction(b.dataset.action, a.id));
    });
  }

  function renderDetail(a) {
    const timingPills = (a.timing || []).map(t => `<span>${escapeHtml(t)}</span>`).join('') || '<span class="text-muted">(none)</span>';
    const newPatientBlock = a.visitCategory === 'New patient' ? `
      <h4 style="margin-top:1.25rem;color:var(--primary-dark);font-family:var(--serif);">New patient info</h4>
      <dl class="detail-grid">
        <dt>Previous doctor</dt><dd>${escapeHtml(a.previousDoctor || '—')} ${a.previousDoctorLastVisit ? '<span class="text-muted">('+escapeHtml(a.previousDoctorLastVisit)+')</span>' : ''}</dd>
        <dt>Records transfer</dt><dd>${escapeHtml(a.recordsTransfer || '—')}</dd>
        <dt>Conditions</dt><dd>${escapeHtml(a.medicalConditions || '—')}</dd>
        <dt>Medications</dt><dd style="white-space:pre-wrap;">${escapeHtml(a.medications || '—')}</dd>
        <dt>Allergies</dt><dd>${escapeHtml(a.allergies || '—')}</dd>
        <dt>Surgeries / hosp.</dt><dd style="white-space:pre-wrap;">${escapeHtml(a.surgeries || '—')}</dd>
        <dt>Family history</dt><dd style="white-space:pre-wrap;">${escapeHtml(a.familyHistory || '—')}</dd>
      </dl>
    ` : '';
    const bookerBlock = a.bookingFor === 'Other' ? `
      <h4 style="margin-top:1.25rem;color:var(--primary-dark);font-family:var(--serif);">Booked by (not the patient)</h4>
      <dl class="detail-grid">
        <dt>Name</dt><dd>${escapeHtml(a.bookerName || '—')}</dd>
        <dt>Relation</dt><dd>${escapeHtml(a.bookerRelation || '—')}</dd>
        <dt>Email</dt><dd>${a.bookerEmail ? `<a href="mailto:${escapeHtml(a.bookerEmail)}">${escapeHtml(a.bookerEmail)}</a>` : '—'}</dd>
        <dt>Phone</dt><dd>${escapeHtml(a.bookerPhone || '—')}</dd>
      </dl>
    ` : '';
    const followupBlock = a.visitCategory === 'Follow-up' ? `
      <dl class="detail-grid">
        <dt>Following up on</dt><dd>${escapeHtml(a.followupContext || '—')}</dd>
      </dl>
    ` : '';
    const scheduledBlock = a.scheduledAt ? `
      <div class="alert alert-success">
        <strong>Scheduled:</strong> ${new Date(a.scheduledAt).toLocaleString()} with ${escapeHtml(a.scheduledWith || a.preferredDoctor)}
      </div>
    ` : '';

    return `
      ${scheduledBlock}

      <div class="flex-gap mb-2">
        <span class="badge ${categoryClass(a.visitCategory)}">${escapeHtml(a.visitCategory || 'Routine')}</span>
        <span class="badge ${statusClass(a.status)}">${escapeHtml(a.status)}</span>
        <span class="text-muted" style="font-size:.85rem;">Submitted ${new Date(a.submittedAt).toLocaleString()}</span>
      </div>

      <h4 style="color:var(--primary-dark);font-family:var(--serif);">
        Patient
        ${a.emailVerified ? '<span class="badge badge-accent" style="margin-left:.5rem;font-size:.7rem;">✓ Email verified</span>' : ''}
      </h4>
      <dl class="detail-grid">
        <dt>Name</dt><dd><strong>${escapeHtml(a.firstName + ' ' + a.lastName)}</strong></dd>
        <dt>DOB</dt><dd>${escapeHtml(a.dob || '—')}</dd>
        <dt>OHIP</dt><dd>${escapeHtml(a.ohip || '—')}</dd>
        <dt>Email</dt><dd>${a.email ? `<a href="mailto:${escapeHtml(a.email)}">${escapeHtml(a.email)}</a>` : '—'}</dd>
        <dt>Phone</dt><dd>${escapeHtml(a.phone || '—')}</dd>
        <dt>Address</dt><dd>${escapeHtml(a.address || '—')}</dd>
      </dl>

      ${bookerBlock}

      <h4 style="margin-top:1.25rem;color:var(--primary-dark);font-family:var(--serif);">Visit</h4>
      <dl class="detail-grid">
        <dt>Preferred doctor</dt><dd>${escapeHtml(a.preferredDoctor || 'Any available')}${doctorFlexibilityNote(a)}</dd>
        <dt>Category</dt><dd>${escapeHtml(a.visitCategory || '—')}</dd>
        ${a.urgency ? `<dt>Urgency</dt><dd>${escapeHtml(a.urgency)}</dd>` : ''}
        <dt>Visit format</dt><dd>${escapeHtml(a.visitType || '—')}</dd>
        <dt>Timing prefs</dt><dd class="timing-prefs">${timingPills}</dd>
      </dl>

      ${followupBlock}

      <h4 style="margin-top:1.25rem;color:var(--primary-dark);font-family:var(--serif);">Reason for visit</h4>
      <p style="white-space:pre-wrap;">${escapeHtml(a.symptoms || '—')}</p>

      ${a.notes ? `
        <h4 style="color:var(--primary-dark);font-family:var(--serif);">Additional notes</h4>
        <p style="white-space:pre-wrap;">${escapeHtml(a.notes)}</p>
      ` : ''}

      ${newPatientBlock}

      <h4 style="margin-top:1.25rem;color:var(--primary-dark);font-family:var(--serif);">Schedule this appointment</h4>
      <div class="form-row">
        <div class="form-group">
          <label>Date & time</label>
          <input type="datetime-local" id="schedule-when" value="${a.scheduledAt ? toLocalInput(a.scheduledAt) : ''}">
        </div>
        <div class="form-group">
          <label>With</label>
          <select id="schedule-with">
            <option value="">Select…</option>
            <option ${a.scheduledWith==='Dr. Marc Habib'?'selected':''}>Dr. Marc Habib</option>
            <option ${a.scheduledWith==='Dr. Safaa Tawfik-Helmy'?'selected':''}>Dr. Safaa Tawfik-Helmy</option>
            <option ${a.scheduledWith==='Dr. Eskander'?'selected':''}>Dr. Eskander</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <label>Internal note (only visible to staff)</label>
        <textarea id="schedule-note" rows="2" placeholder="Anything for the chart or front desk."></textarea>
      </div>
    `;
  }

  function renderDetailFooter(a) {
    return `
      <button class="btn btn-ghost" data-modal-close>Close</button>
      <button class="btn btn-outline" data-action="email-patient">📧 Email patient</button>
      ${a.status !== 'Declined' ? '<button class="btn btn-ghost" data-action="decline">Decline</button>' : ''}
      <button class="btn btn-accent" data-action="confirm">${a.scheduledAt ? '✓ Update & confirm' : '✓ Confirm appointment'}</button>
    `;
  }

  function toLocalInput(iso) {
    const d = new Date(iso);
    const pad = n => String(n).padStart(2,'0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function quickConfirm(id) {
    const a = MC.store.list().find(x => x.id === id);
    if (!a) return;
    openDetail(id);
  }

  function handleAction(action, id) {
    const a = MC.store.list().find(x => x.id === id);
    if (!a) return;
    if (action === 'confirm') {
      const when = document.getElementById('schedule-when').value;
      const withDr = document.getElementById('schedule-with').value;
      if (!when || !withDr) {
        alert('Please choose a date/time and which doctor will see the patient.');
        return;
      }
      const note = document.getElementById('schedule-note').value;
      confirmAppointment(id, new Date(when).toISOString(), withDr, note);
    } else if (action === 'decline') {
      const reason = prompt('Optional message to the patient about why we are declining:');
      declineAppointment(id, reason || '');
    } else if (action === 'email-patient') {
      emailPatient(a);
    }
  }

  /* ---- Integration points (currently email; Outlook later) ---- */

  function confirmAppointment(id, isoWhen, withDr, note) {
    const updated = MC.store.update(id, {
      status: 'Confirmed',
      scheduledAt: isoWhen,
      scheduledWith: withDr,
      internalNote: note
    });
    // TEMP: open a pre-filled confirmation email to the patient.
    // FUTURE: server creates Outlook event + sends formatted email/SMS.
    const link = buildConfirmEmail(updated);
    window.open(link, '_blank');
    modal.classList.remove('open');
    render();
  }

  function declineAppointment(id, reason) {
    const updated = MC.store.update(id, {
      status: 'Declined',
      declineReason: reason
    });
    const link = buildDeclineEmail(updated);
    window.open(link, '_blank');
    modal.classList.remove('open');
    render();
  }

  function emailPatient(a) {
    const to = a.email || a.bookerEmail || '';
    const subject = encodeURIComponent(`${a.id} — St. George Medical Centre`);
    const body = encodeURIComponent(
`Hi ${a.firstName},

Following up on your appointment request (${a.id}) submitted on ${new Date(a.submittedAt).toLocaleDateString()}.

— St. George Medical Centre Waterdown
(289) 895-7862`);
    window.open(`mailto:${to}?subject=${subject}&body=${body}`, '_blank');
  }

  function buildConfirmEmail(a) {
    const to = a.email || a.bookerEmail || '';
    const cc = a.bookingFor === 'Other' && a.bookerEmail && a.email ? '&cc=' + encodeURIComponent(a.bookerEmail) : '';
    const subject = encodeURIComponent(
      `Your appointment is confirmed — ${new Date(a.scheduledAt).toLocaleString()} with ${a.scheduledWith}`
    );
    const body = encodeURIComponent(
`Hi ${a.firstName},

Your appointment at St. George Medical Centre Waterdown has been confirmed.

  Date & time: ${new Date(a.scheduledAt).toLocaleString()}
  With:        ${a.scheduledWith}
  Visit type:  ${a.visitType || 'In-person'}
  Reference:   ${a.id}

Location:
  250 Dundas St E, Unit 3
  Waterdown, ON L8B 0E7

What to bring:
  - Your OHIP card
  - A list of any medications you're currently taking
  - Any forms we asked you to complete

You will receive a reminder 24 hours and 2 hours before your appointment.

If you need to change or cancel, please call (289) 895-7862 as soon as possible.

— St. George Medical Centre Waterdown`);
    return `mailto:${to}?subject=${subject}&body=${body}${cc}`;
  }

  function buildDeclineEmail(a) {
    const to = a.email || a.bookerEmail || '';
    const subject = encodeURIComponent(`About your appointment request — ${a.id}`);
    const body = encodeURIComponent(
`Hi ${a.firstName},

Thank you for reaching out to St. George Medical Centre Waterdown.

Unfortunately, we're unable to fit your appointment request at this time. ${a.declineReason ? '\n' + a.declineReason + '\n' : ''}

If this is urgent, please call us at (289) 895-7862, or visit our walk-in clinic during regular hours.

For after-hours non-emergency advice, call Telehealth Ontario at 811.
For emergencies, call 911.

— St. George Medical Centre Waterdown`);
    return `mailto:${to}?subject=${subject}&body=${body}`;
  }

  // First render
  render();
})();
