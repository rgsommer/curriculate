// backend/behavior/lib/providers/EdsbyProvider.js
//
// Edsby implementation of NotificationProvider — PHASE 3 (brief §4).
//
// ⚠️  RISK (flagged to the school): Edsby has NO official public API. Delivery
// works by authenticated cookie/session posting — logging in (handling the CSRF
// token + cookies) and posting to Edsby form endpoints. This is brittle and may
// break without notice. ALL of that login/CSRF/cookie handling must live in
// THIS module and nowhere else, so the fragility is quarantined. Credentials
// are read from encrypted server-side secrets only — never from the database in
// plaintext, never in client code.
//
// Until Phase 3 lands this is an explicit stub that reports failure, so the
// notify() orchestrator transparently fails over to email (brief §4.1).

import { NotificationProvider } from "./NotificationProvider.js";

export class EdsbyProvider extends NotificationProvider {
  get key() {
    return "edsby";
  }

  async send({ recipient }) {
    // Phase 3 will implement: load encrypted creds -> establish session ->
    // fetch CSRF token -> POST message to recipient.edsbyParentId. For now,
    // signal not-implemented so the orchestrator fails over to email.
    void recipient;
    return {
      ok: false,
      error: "EdsbyProvider not yet implemented (Phase 3) — failing over to email",
      channel: this.key,
    };
  }
}

export default EdsbyProvider;
