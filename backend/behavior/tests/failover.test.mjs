// node --test backend/behavior/tests/failover.test.mjs
//
// Tests provider failover (brief §4.1, §11): when an Edsby post fails, delivery
// falls over to email. Providers are injected, so no network/DB is touched.

import { test } from "node:test";
import assert from "node:assert/strict";
import { sendWithFailover } from "../lib/notify.js";
import { EdsbyProvider } from "../lib/providers/EdsbyProvider.js";

const recipient = { role: "parent", name: "Parent", email: "parent@example.com", edsbyParentId: "p123" };

function fakeProvider(key, ok, recorder) {
  return {
    get key() { return key; },
    async send(args) {
      recorder.push({ key, to: args.recipient.email });
      return ok ? { ok: true, channel: key } : { ok: false, error: `${key} down`, channel: key };
    },
  };
}

test("Edsby failure fails over to email", async () => {
  const calls = [];
  const providers = {
    edsby: fakeProvider("edsby", false, calls),
    email: fakeProvider("email", true, calls),
  };
  const results = await sendWithFailover({
    recipient,
    channels: ["edsby"],
    subject: "s",
    body: "b",
    providers,
  });
  // edsby attempted (failed) then email attempted (failover, ok).
  assert.equal(results.length, 2);
  assert.equal(results[0].channel, "edsby");
  assert.equal(results[0].ok, false);
  assert.equal(results[1].channel, "email");
  assert.equal(results[1].ok, true);
  assert.equal(results[1].failover, true);
});

test("No double-send when email is already a requested channel", async () => {
  const calls = [];
  const providers = {
    edsby: fakeProvider("edsby", false, calls),
    email: fakeProvider("email", true, calls),
  };
  const results = await sendWithFailover({
    recipient,
    channels: ["edsby", "email"],
    subject: "s",
    body: "b",
    providers,
  });
  // edsby (fail) + email (the requested one) — NOT a third failover email.
  assert.equal(results.length, 2);
  assert.equal(calls.filter((c) => c.key === "email").length, 1);
});

test("Both channels succeed when both are healthy", async () => {
  const calls = [];
  const providers = {
    edsby: fakeProvider("edsby", true, calls),
    email: fakeProvider("email", true, calls),
  };
  const results = await sendWithFailover({
    recipient,
    channels: ["edsby", "email"],
    subject: "s",
    body: "b",
    providers,
  });
  assert.equal(results.length, 2);
  assert.ok(results.every((r) => r.ok));
});

test("EdsbyProvider stub reports not-implemented (so it fails over until Phase 3)", async () => {
  const r = await new EdsbyProvider().send({ recipient });
  assert.equal(r.ok, false);
  assert.match(r.error, /not yet implemented/i);
});
