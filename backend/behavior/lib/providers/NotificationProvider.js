// backend/behavior/lib/providers/NotificationProvider.js
//
// The channel-agnostic notification interface (brief §4). The rest of the app
// composes a notice and hands it to a provider; it must NOT care whether the
// delivery happens over Edsby or email. Two implementations exist:
// EmailProvider (live day one) and EdsbyProvider (Phase 3). Adding Edsby later
// changes nothing above this line.
//
// A provider implements:
//   key                         -> "email" | "edsby"
//   async send({ recipient, subject, body, student, notice })
//        -> { ok: boolean, error?: string, channel: string }
//
// `recipient` is one of the notice's RecipientSchema entries
// ({ role, name, email, edsbyParentId }).

export class NotificationProvider {
  get key() {
    throw new Error("NotificationProvider.key not implemented");
  }

  // eslint-disable-next-line no-unused-vars
  async send(_args) {
    throw new Error("NotificationProvider.send not implemented");
  }
}

export default NotificationProvider;
