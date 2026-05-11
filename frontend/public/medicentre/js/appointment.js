/* MediCentre — Appointment intake & submission
 * ---------------------------------------------------------------
 * Current backend mode: EMAIL
 *   - Office gets a structured email at OFFICE_EMAIL
 *   - Patient sees an in-page confirmation and receives a
 *     mailto-prepared confirmation (or simply the on-page receipt)
 *   - Request is also stored locally so the Admin dashboard can
 *     process it (this would be a real DB in production)
 *
 * Future backend mode: OUTLOOK
 *   - submitAppointmentRequest() is the single entry point.
 *     When the Microsoft Graph integration is ready, swap the
 *     body of that function to also POST to /api/appointments,
 *     and add a checkAvailability() / createEvent() call against
 *     the clinic's shared Outlook calendar. The rest of the
 *     site does not need to change.
 * --------------------------------------------------------------- */

(function () {
  // The API routes live in the Next.js app at /api/medicentre/* and handle
  // PIN generation, email delivery (via Resend), and PIN verification.
  // No PII is stored in the browser anymore.
  const API_REQUEST_PIN  = '/api/medicentre/request-pin';
  const API_APPOINTMENTS = '/api/medicentre/appointments';

  const CLINIC_NAME = 'St. George Medical Centre Waterdown';
  const CLINIC_PHONE = '(289) 895-7862';

  // BACKEND_MODE controls how submission is wired:
  //   'api'    — POST to the Next.js API routes above (production)
  //   'demo'   — generate PIN client-side and only persist locally
  //              (offline preview; admin dashboard works without a server)
  const BACKEND_MODE = 'api';

  // -------- Prefill doctor from query string ----------
  const params = new URLSearchParams(location.search);
  const doctorParam = params.get('doctor');
  if (doctorParam) {
    const sel = document.querySelector('select[name="preferredDoctor"]');
    if (sel) {
      [...sel.options].forEach(o => {
        if (o.value.toLowerCase() === doctorParam.toLowerCase()) o.selected = true;
      });
    }
  }

  // -------- Form submission ----------
  const form = document.getElementById('appt-form');
  if (!form) return;

  form.addEventListener('submit', async function (e) {
    e.preventDefault();

    const data = collectForm(form);
    const errors = validate(data);
    if (errors.length) {
      showError(errors.join('<br>'));
      return;
    }

    // Spam protection: verify the email address with a 5-digit PIN
    // before we accept the appointment request.
    startEmailVerification(data);
  });

  function collectForm(f) {
    const fd = new FormData(f);
    const timing = fd.getAll('timing');
    const obj = {};
    fd.forEach((v, k) => {
      if (k === 'timing') return; // handled separately
      obj[k] = (typeof v === 'string') ? v.trim() : v;
    });
    obj.timing = timing;
    return obj;
  }

  function validate(d) {
    const errs = [];
    if (!d.preferredDoctor) errs.push('Please choose a doctor (or "Any available") above.');
    if (!d.visitCategory)   errs.push('Please tell us what type of appointment this is.');
    if (!d.firstName) errs.push("Please enter the patient's first name.");
    if (!d.lastName)  errs.push("Please enter the patient's last name.");
    if (!d.dob)       errs.push("Please enter the patient's date of birth — we use it to match the right chart.");

    // We need a verifiable email so we can send the spam-protection PIN.
    const verifyEmail = d.bookingFor === 'Other' ? d.bookerEmail : d.email;
    if (!verifyEmail) {
      errs.push(d.bookingFor === 'Other'
        ? "Please enter your (the booker's) email — we'll send a 5-digit verification code to confirm the request."
        : "Please enter the patient's email — we'll send a 5-digit verification code to confirm the request.");
    }
    if (d.email && !/^\S+@\S+\.\S+$/.test(d.email)) errs.push("That patient email doesn't look right.");
    if (d.bookerEmail && !/^\S+@\S+\.\S+$/.test(d.bookerEmail)) errs.push("That booker email doesn't look right.");
    if (d.bookingFor === 'Other') {
      if (!d.bookerName)     errs.push('Please tell us your name (the person booking).');
      if (!d.bookerRelation) errs.push('Please tell us your relation to the patient.');
    }
    if (!d.symptoms || d.symptoms.length < 5) errs.push('Please tell us a little about the reason for your visit.');
    if (!d.consent) errs.push('Please confirm you consent to be contacted about this appointment.');
    return errs;
  }

  /* ---------------- Email-PIN spam protection ----------------
     We send a 5-digit PIN to the booker/patient email and require
     the user to type it back before the appointment is submitted.

     Current mode (no backend): PIN is generated client-side and
     displayed in a 'demo' notice so the user can complete the
     flow end-to-end. Once a real backend is wired up, replace
     dispatchPin() with a server call (e.g. POST /api/verify-pin).
  --------------------------------------------------------------- */

  // PIN state is stored only as long as the user is on this page.
  // The actual PIN never lives in the browser — only an opaque server token
  // (HMAC-signed by the API) that the server validates on final submit.
  let activeToken = null;     // server-issued JWT-style token (api mode)
  let activeDemoPin = null;   // local PIN string (demo mode only)
  let activePinAttempts = 0;
  let activePinExpiresAt = 0;

  async function startEmailVerification(data) {
    const targetEmail = (data.bookingFor === 'Other') ? data.bookerEmail : data.email;
    activePinAttempts = 0;
    activePinExpiresAt = Date.now() + 10 * 60 * 1000;

    if (BACKEND_MODE === 'api') {
      // Show a small "sending…" state while the API generates + emails the PIN.
      const box = document.getElementById('appt-status');
      box.innerHTML = '<div class="alert alert-info">Sending a verification code to <strong>' + escapeHtml(targetEmail) + '</strong>…</div>';
      try {
        const res = await fetch(API_REQUEST_PIN, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: targetEmail, firstName: data.firstName || '' })
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.token) {
          showError(json.error || 'Could not send a verification code. Please try again, or call ' + CLINIC_PHONE + '.');
          return;
        }
        activeToken = json.token;
        activeDemoPin = null;
        renderPinPrompt(targetEmail, data);
      } catch (err) {
        showError('Could not reach the server. Please call ' + CLINIC_PHONE + '.');
      }
      return;
    }

    // demo mode: generate PIN client-side and surface it on screen
    activeToken = null;
    activeDemoPin = String(Math.floor(10000 + Math.random() * 90000));
    renderPinPrompt(targetEmail, data);
  }

  function renderPinPrompt(targetEmail, data) {
    const box = document.getElementById('appt-status');
    const demoBanner = (BACKEND_MODE === 'demo' && activeDemoPin)
      ? `<div class="alert alert-info" id="demo-pin-banner" style="font-size:.9rem;">
           <strong>Demo mode:</strong> the email backend isn't running, so we generated the code locally:
           <code style="background:#fff;padding:.1rem .4rem;border-radius:4px;letter-spacing:.15em;">${activeDemoPin}</code>.
         </div>`
      : '';

    box.innerHTML = `
      <div class="card" id="pin-card">
        <h3 style="font-family:var(--serif);color:var(--primary-dark);">📧 Confirm your email</h3>
        <p>We've sent a 5-digit verification code to <strong>${escapeHtml(targetEmail)}</strong>.
           Enter it below to submit your appointment request.</p>
        ${demoBanner}
        <div class="form-row" style="grid-template-columns: 1fr auto; gap:.75rem;">
          <input type="text" id="pin-input" maxlength="5" inputmode="numeric" pattern="[0-9]{5}"
                 placeholder="• • • • •"
                 style="text-align:center;font-size:1.4rem;letter-spacing:.4em;font-weight:600;font-family:inherit;">
          <button type="button" class="btn btn-primary btn-lg" id="pin-verify-btn">Verify & submit</button>
        </div>
        <div class="flex-between mt-2" style="font-size:.9rem;">
          <a href="#" id="pin-resend">Resend code</a>
          <a href="#" id="pin-change-email">Use a different email</a>
        </div>
        <div id="pin-error"></div>
      </div>
    `;
    box.scrollIntoView({ behavior:'smooth', block:'center' });

    const pinInput = document.getElementById('pin-input');
    const verifyBtn = document.getElementById('pin-verify-btn');
    const errBox = document.getElementById('pin-error');
    pinInput.focus();

    pinInput.addEventListener('input', () => {
      pinInput.value = pinInput.value.replace(/\D/g,'').slice(0,5);
    });
    pinInput.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') verifyBtn.click();
    });

    verifyBtn.addEventListener('click', async () => {
      errBox.innerHTML = '';
      const entered = pinInput.value.trim();
      if (!/^\d{5}$/.test(entered)) {
        errBox.innerHTML = '<div class="alert alert-danger mt-2">Please enter the 5-digit code from your email.</div>';
        return;
      }
      if (Date.now() > activePinExpiresAt) {
        errBox.innerHTML = '<div class="alert alert-danger mt-2">That code has expired. Click "Resend code" to get a new one.</div>';
        return;
      }

      verifyBtn.disabled = true;
      verifyBtn.textContent = 'Submitting…';

      try {
        if (BACKEND_MODE === 'api') {
          const result = await submitViaApi(data, entered);
          showSuccess(result);
        } else {
          // demo mode: local check
          activePinAttempts++;
          if (entered !== activeDemoPin) {
            if (activePinAttempts >= 5) {
              errBox.innerHTML = '<div class="alert alert-danger mt-2">Too many incorrect attempts. Please refresh the page and try again, or call us at ' + CLINIC_PHONE + '.</div>';
              verifyBtn.disabled = true;
              return;
            }
            errBox.innerHTML = `<div class="alert alert-danger mt-2">That code didn't match — please check your email and try again. (Attempt ${activePinAttempts} of 5.)</div>`;
            pinInput.select();
            verifyBtn.disabled = false;
            verifyBtn.textContent = 'Verify & submit';
            return;
          }
          const stored = persistLocally(data);
          showSuccess(stored);
        }

        form.reset();
        document.querySelectorAll('input[name="visitCategory"]').forEach(r => r.checked = false);
        ['urgency-detail-group','new-patient-group','followup-group','booker-block','flexible-doctor-row'].forEach(id => {
          const el = document.getElementById(id); if (el) el.style.display = 'none';
        });
      } catch (err) {
        const msg = (err && err.message) ? err.message : 'Sorry — we could not submit your request right now. Please call ' + CLINIC_PHONE + '.';
        errBox.innerHTML = '<div class="alert alert-danger mt-2">' + escapeHtml(msg) + '</div>';
        verifyBtn.disabled = false;
        verifyBtn.textContent = 'Verify & submit';
      }
    });

    document.getElementById('pin-resend').addEventListener('click', async (ev) => {
      ev.preventDefault();
      errBox.innerHTML = '<div class="alert alert-info mt-2">Sending a new code…</div>';
      activePinAttempts = 0;
      activePinExpiresAt = Date.now() + 10 * 60 * 1000;

      if (BACKEND_MODE === 'api') {
        try {
          const res = await fetch(API_REQUEST_PIN, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: targetEmail, firstName: data.firstName || '' })
          });
          const json = await res.json().catch(() => ({}));
          if (!res.ok || !json.token) {
            errBox.innerHTML = '<div class="alert alert-danger mt-2">' + escapeHtml(json.error || 'Could not send a new code.') + '</div>';
            return;
          }
          activeToken = json.token;
          errBox.innerHTML = '<div class="alert alert-success mt-2">A new code was sent to your email.</div>';
        } catch {
          errBox.innerHTML = '<div class="alert alert-danger mt-2">Could not reach the server. Please call ' + CLINIC_PHONE + '.</div>';
        }
      } else {
        activeDemoPin = String(Math.floor(10000 + Math.random() * 90000));
        const banner = document.getElementById('demo-pin-banner');
        if (banner) banner.innerHTML = '<strong>Demo mode:</strong> a new code was generated. Your code is now <code style="background:#fff;padding:.1rem .4rem;border-radius:4px;letter-spacing:.15em;">' + activeDemoPin + '</code>.';
        errBox.innerHTML = '<div class="alert alert-success mt-2">A new code was generated.</div>';
      }
    });

    document.getElementById('pin-change-email').addEventListener('click', (ev) => {
      ev.preventDefault();
      box.innerHTML = '';
      const target = (data.bookingFor === 'Other') ? form.querySelector('input[name="bookerEmail"]') : form.querySelector('input[name="email"]');
      if (target) { target.focus(); target.scrollIntoView({behavior:'smooth', block:'center'}); }
    });
  }

  // ----- API submission ----------------------------------------------------
  async function submitViaApi(data, pin) {
    const payload = Object.assign({}, data, { token: activeToken, pin });
    delete payload.consent;
    const res = await fetch(API_APPOINTMENTS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) {
      throw new Error(json.error || 'The clinic could not be reached.');
    }
    return Object.assign({}, data, {
      id: json.id,
      emailVerified: true,
      submittedAt: new Date().toISOString()
    });
  }

  function persistLocally(data) {
    return MC.store.add(Object.assign({
      emailVerified: true,
      status: 'Pending'
    }, data));
  }

  function setSubmitting(on) {
    const btn = form.querySelector('button[type="submit"]');
    if (!btn) return;
    btn.disabled = on;
    btn.textContent = on ? 'Submitting…' : 'Submit appointment request';
  }

  function showError(html) {
    const box = document.getElementById('appt-status');
    box.innerHTML = '<div class="alert alert-danger">' + html + '</div>';
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function showSuccess(req) {
    const box = document.getElementById('appt-status');
    const mailto = buildPatientEmailLink(req);
    box.innerHTML = `
      <div class="alert alert-success">
        <strong>Thank you, ${escapeHtml(req.firstName)} — your request has been received.</strong><br>
        Your reference number is <strong>${req.id}</strong>.
        Our team will review your preferences and confirm your appointment by email or text shortly.
      </div>
      <div class="card">
        <h3>What happens next</h3>
        <ol>
          <li>Reception reviews your request — usually within one business day.</li>
          <li>We match you with the next available time that fits your preferences.</li>
          <li>You receive a confirmation email${req.phone ? ' or text' : ''} with the appointment details.</li>
          <li>We send you reminders 24 hours and 2 hours before your visit.</li>
        </ol>
        <p class="text-muted mt-2" style="font-size:.92rem;">
          Need to reach us in the meantime? Call <strong>${CLINIC_PHONE}</strong>.
        </p>
        <a class="btn btn-outline btn-sm" href="${mailto}">
          Save a copy of this request to your inbox
        </a>
      </div>
    `;
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
    }[c]));
  }

  // ----- Patient "save a copy" mailto link (offered on the receipt screen) -----
  function buildPatientEmailLink(r) {
    const subject = `Your appointment request — ${CLINIC_NAME} (${r.id})`;
    const body =
`Hi ${r.firstName},

Thank you for submitting an appointment request with ${CLINIC_NAME}. Our team will review and confirm your appointment shortly.

YOUR REQUEST
  Reference:        ${r.id}
  Preferred doctor: ${r.preferredDoctor || 'Any available'}${r.preferredDoctor && r.preferredDoctor !== 'Any available' && r.preferredDoctor !== 'Walk-in / Urgent' ? (r.flexibleOnDoctor ? '  (or any if unavailable)' : '  (this doctor only)') : ''}
  Urgency:          ${r.urgency || '(not specified)'}
  Visit type:       ${r.visitType || '(not specified)'}
  Timing prefs:     ${(r.timing || []).join(', ') || '(none)'}

Reason for visit:
${r.symptoms || ''}

If anything changes or you'd like to reach us, call ${CLINIC_PHONE}.

—
${CLINIC_NAME}
250 Dundas St E, Unit 3, Waterdown, ON L8B 0E7`;
    const to = r.email || r.bookerEmail || '';
    return 'mailto:' + to +
      '?subject=' + encodeURIComponent(subject) +
      '&body=' + encodeURIComponent(body);
  }
})();
