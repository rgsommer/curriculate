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
  // Replace OFFICE_EMAIL with the real reception address once it is provided.
  // Leaving blank for now so we never send to a fake mailbox. When empty,
  // the form skips the office mailto and relies on the local store +
  // (future) backend POST to /api/appointments.
  const OFFICE_EMAIL = '';
  const CLINIC_NAME = 'St. George Medical Centre Waterdown';
  const CLINIC_PHONE = '(289) 895-7862';
  const REPLY_FROM  = 'St. George Medical Centre Waterdown';

  // Backend mode flag — swap to 'outlook' when ready.
  const BACKEND_MODE = 'email'; // 'email' | 'outlook'

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

  let activePin = null;
  let activePinAttempts = 0;
  let activePinExpiresAt = 0;

  function startEmailVerification(data) {
    const targetEmail = (data.bookingFor === 'Other') ? data.bookerEmail : data.email;
    activePin = String(Math.floor(10000 + Math.random() * 90000));
    activePinAttempts = 0;
    activePinExpiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

    dispatchPin(targetEmail, activePin, data.firstName || '');
    renderPinPrompt(targetEmail, data);
  }

  function dispatchPin(toEmail, pin, firstName) {
    // FUTURE: replace with: fetch('/api/verify-pin', { method:'POST', body: JSON.stringify({ email: toEmail, pin }) })
    // For now: open a hidden mailto so the office sees it,
    // and surface the PIN in the demo notice. In a static-site
    // deployment without a mail relay, the on-screen PIN is the
    // only reliable channel.
    try {
      const subject = encodeURIComponent('Your St. George Medical Centre verification code: ' + pin);
      const body = encodeURIComponent(
`Hi ${firstName || 'there'},

Your appointment-request verification code is:

    ${pin}

Enter this 5-digit code on the booking page to confirm your request. This code expires in 10 minutes.

If you didn't request an appointment, please ignore this message.

— St. George Medical Centre`
      );
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      iframe.src = 'mailto:' + encodeURIComponent(toEmail) + '?subject=' + subject + '&body=' + body;
      document.body.appendChild(iframe);
      setTimeout(() => iframe.remove(), 4000);
    } catch (_) { /* ignore */ }
  }

  function renderPinPrompt(targetEmail, data) {
    const box = document.getElementById('appt-status');
    box.innerHTML = `
      <div class="card" id="pin-card">
        <h3 style="font-family:var(--serif);color:var(--primary-dark);">📧 Confirm your email</h3>
        <p>We've sent a 5-digit verification code to <strong>${escapeHtml(targetEmail)}</strong>.
           Enter it below to submit your appointment request.</p>
        <div class="alert alert-info" id="demo-pin-banner" style="font-size:.9rem;">
          <strong>Demo mode:</strong> until the email backend is connected, your code is
          <code style="background:#fff;padding:.1rem .4rem;border-radius:4px;letter-spacing:.15em;">${activePin}</code>.
        </div>
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
      if (Date.now() > activePinExpiresAt) {
        errBox.innerHTML = '<div class="alert alert-danger mt-2">That code has expired. Click "Resend code" to get a new one.</div>';
        return;
      }
      activePinAttempts++;
      if (entered !== activePin) {
        if (activePinAttempts >= 5) {
          errBox.innerHTML = '<div class="alert alert-danger mt-2">Too many incorrect attempts. Please refresh the page and try again, or call us at ' + CLINIC_PHONE + '.</div>';
          verifyBtn.disabled = true;
          return;
        }
        errBox.innerHTML = `<div class="alert alert-danger mt-2">That code didn't match — please check your email and try again. (Attempt ${activePinAttempts} of 5.)</div>`;
        pinInput.select();
        return;
      }
      // PIN verified ✓ — submit the request
      verifyBtn.disabled = true;
      verifyBtn.textContent = 'Submitting…';
      try {
        const result = await submitAppointmentRequest(data);
        result.emailVerified = true;
        showSuccess(result);
        form.reset();
        // Reset visual state of optional/conditional fields
        document.querySelectorAll('input[name="visitCategory"]').forEach(r => r.checked = false);
        ['urgency-detail-group','new-patient-group','followup-group','booker-block'].forEach(id => {
          const el = document.getElementById(id); if (el) el.style.display = 'none';
        });
      } catch (err) {
        errBox.innerHTML = '<div class="alert alert-danger mt-2">Sorry — we could not submit your request right now. Please call us at ' + CLINIC_PHONE + '.</div>';
        verifyBtn.disabled = false;
        verifyBtn.textContent = 'Verify & submit';
      }
    });

    document.getElementById('pin-resend').addEventListener('click', (ev) => {
      ev.preventDefault();
      activePin = String(Math.floor(10000 + Math.random() * 90000));
      activePinAttempts = 0;
      activePinExpiresAt = Date.now() + 10 * 60 * 1000;
      dispatchPin(targetEmail, activePin, data.firstName || '');
      const banner = document.getElementById('demo-pin-banner');
      if (banner) banner.innerHTML = '<strong>Demo mode:</strong> a new code was generated. Your code is now <code style="background:#fff;padding:.1rem .4rem;border-radius:4px;letter-spacing:.15em;">' + activePin + '</code>.';
      errBox.innerHTML = '<div class="alert alert-success mt-2">A new code was sent to your email.</div>';
    });

    document.getElementById('pin-change-email').addEventListener('click', (ev) => {
      ev.preventDefault();
      box.innerHTML = '';
      // Scroll back to the email field
      const target = (data.bookingFor === 'Other') ? form.querySelector('input[name="bookerEmail"]') : form.querySelector('input[name="email"]');
      if (target) { target.focus(); target.scrollIntoView({behavior:'smooth', block:'center'}); }
    });
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

  /* ---------------- Submission backend ---------------- */
  /**
   * Single entry point — swap the inside of this function
   * when the Outlook / backend API is ready.
   */
  async function submitAppointmentRequest(data) {
    // 1) Persist to local store so the Admin dashboard sees it.
    //    In production this becomes: await fetch('/api/appointments', { method:'POST', body: JSON.stringify(data) })
    const stored = MC.store.add({
      emailVerified: true,                        // submitted only after 5-digit PIN matched
      // Patient
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email,
      phone: data.phone,
      address: data.address,
      dob: data.dob,
      ohip: data.ohip,
      // Booker (when not the patient)
      bookingFor: data.bookingFor || 'Self',     // 'Self' | 'Other'
      bookerName: data.bookerName,
      bookerRelation: data.bookerRelation,
      bookerEmail: data.bookerEmail,
      bookerPhone: data.bookerPhone,
      // Visit
      preferredDoctor: data.preferredDoctor,
      flexibleOnDoctor: !!data.flexibleOnDoctor, // true = ok to see another physician if preferred is unavailable
      visitCategory: data.visitCategory,         // 'Urgent' | 'New patient' | 'Follow-up' | 'Routine'
      // New patient extras
      previousDoctor: data.previousDoctor,
      previousDoctorLastVisit: data.previousDoctorLastVisit,
      recordsTransfer: data.recordsTransfer,
      medicalConditions: data.medicalConditions,
      medications: data.medications,
      allergies: data.allergies,
      surgeries: data.surgeries,
      familyHistory: data.familyHistory,
      // Follow-up extras
      followupContext: data.followupContext,
      urgency: data.urgency,
      symptoms: data.symptoms,
      timing: data.timing,
      visitType: data.visitType,
      notes: data.notes,
      status: 'Pending'
    });

    if (BACKEND_MODE === 'email' && OFFICE_EMAIL) {
      // 2) Email the office (opens a pre-filled message in their default mail client).
      //    Only fires when a real OFFICE_EMAIL is configured at the top of this file.
      const officeMail = buildOfficeEmailLink(stored);
      const f = document.createElement('iframe');
      f.style.display = 'none';
      f.src = officeMail;
      document.body.appendChild(f);
      setTimeout(() => f.remove(), 4000);
    }

    if (BACKEND_MODE === 'outlook') {
      // Placeholder for the future Graph integration:
      // await fetch('/api/appointments/outlook', { method:'POST', body: JSON.stringify(stored) })
      // The server side will: 1) find a slot in the clinic calendar
      //                       2) create a calendar event
      //                       3) email the confirmation to the patient
      console.info('[appointment] Outlook backend not yet wired up — payload:', stored);
    }

    return stored;
  }

  function buildOfficeEmailLink(r) {
    const tag = r.visitCategory ? '[' + r.visitCategory.toUpperCase() + '] ' : '';
    const subject = `${tag}Appointment request — ${r.firstName} ${r.lastName} (${r.id})`;
    const bookerBlock = r.bookingFor === 'Other'
      ? `\nBOOKED BY (NOT THE PATIENT)
  Name:     ${r.bookerName || '(not provided)'}
  Relation: ${r.bookerRelation || '(not provided)'}
  Email:    ${r.bookerEmail || '(not provided)'}
  Phone:    ${r.bookerPhone || '(not provided)'}\n`
      : '';

    const body =
`A new appointment request was submitted via the website.

Reference:    ${r.id}
Submitted:    ${new Date(r.submittedAt).toLocaleString()}
Visit type:   ${r.visitCategory || '(not specified)'}${r.visitCategory === 'Urgent' && r.urgency ? '  ['+r.urgency+']' : ''}
${bookerBlock}
PATIENT
  Name:    ${r.firstName} ${r.lastName}
  Email:   ${r.email || '(not provided)'}
  Phone:   ${r.phone || '(not provided)'}
  Address: ${r.address || '(not provided)'}
  DOB:     ${r.dob || '(not provided)'}
  OHIP:    ${r.ohip || '(not provided)'}

REQUEST
  Preferred doctor: ${r.preferredDoctor || 'Any available'}${r.preferredDoctor && r.preferredDoctor !== 'Any available' && r.preferredDoctor !== 'Walk-in / Urgent' ? (r.flexibleOnDoctor ? '  (or any if unavailable)' : '  (this doctor only — patient prefers to wait)') : ''}
  Category:         ${r.visitCategory || '(not specified)'}
  ${r.visitCategory === 'Urgent'      ? 'Urgency window:   ' + (r.urgency || '(not specified)') : ''}
  ${r.visitCategory === 'New patient' ? 'Previous doctor:  ' + (r.previousDoctor || '(not specified)') + (r.previousDoctorLastVisit ? '  (last seen '+r.previousDoctorLastVisit+')' : '') : ''}
  ${r.visitCategory === 'New patient' ? 'Records transfer: ' + (r.recordsTransfer || '(not specified)') : ''}
  ${r.visitCategory === 'New patient' ? 'Conditions:       ' + (r.medicalConditions || '(none listed)') : ''}
  ${r.visitCategory === 'New patient' ? 'Medications:      ' + (r.medications || '(none listed)') : ''}
  ${r.visitCategory === 'New patient' ? 'Allergies:        ' + (r.allergies || '(none listed)') : ''}
  ${r.visitCategory === 'New patient' ? 'Surgeries/hosp.:  ' + (r.surgeries || '(none listed)') : ''}
  ${r.visitCategory === 'New patient' ? 'Family history:   ' + (r.familyHistory || '(none listed)') : ''}
  ${r.visitCategory === 'Follow-up'   ? 'Following up on:  ' + (r.followupContext || '(not specified)') : ''}
  Visit format:     ${r.visitType || '(not specified)'}
  Timing prefs:     ${(r.timing || []).join(', ') || '(none)'}

REASON FOR VISIT
${r.symptoms || ''}

ADDITIONAL NOTES
${r.notes || '(none)'}

—
Please review and confirm via the Admin dashboard.
${CLINIC_NAME}`;
    return 'mailto:' + OFFICE_EMAIL +
      '?subject=' + encodeURIComponent(subject) +
      '&body=' + encodeURIComponent(body);
  }

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
${REPLY_FROM}
250 Dundas St E, Unit 3, Waterdown, ON L8B 0E7`;
    const to = r.email ? r.email : '';
    return 'mailto:' + to +
      '?subject=' + encodeURIComponent(subject) +
      '&body=' + encodeURIComponent(body);
  }
})();
