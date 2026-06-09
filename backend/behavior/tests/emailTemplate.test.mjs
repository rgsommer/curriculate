// node --test backend/behavior/tests/emailTemplate.test.mjs
//
// The shared HTML email shell + plain-note-to-HTML conversion.

import { test } from "node:test";
import assert from "node:assert/strict";
import { emailShell, noteToHtml, emailButton, escapeHtml } from "../lib/emailTemplate.js";

test("escapeHtml neutralises markup", () => {
  assert.equal(escapeHtml(`<b>&"x`), "&lt;b&gt;&amp;&quot;x");
});

test("emailShell wraps content with school + title and escapes them", () => {
  const html = emailShell({ title: "Hi <there>", schoolName: "BCS & Co", contentHtml: "<p>body</p>" });
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /Hi &lt;there&gt;/);
  assert.match(html, /BCS &amp; Co/);
  assert.match(html, /<p>body<\/p>/);
});

test("noteToHtml turns paragraphs + bullets into <p> and <ul>", () => {
  const note = [
    "Dear Parent/Guardian,",
    "",
    "The following were recorded:",
    "  • Jun 5: Talking out",
    "  • Jun 6: Disruptive",
    "",
    "Thank you.",
  ].join("\n");
  const html = noteToHtml(note);
  assert.match(html, /<p[^>]*>Dear Parent\/Guardian,<\/p>/);
  assert.match(html, /<ul[^>]*>.*Talking out.*Disruptive.*<\/ul>/s);
  assert.match(html, /<p[^>]*>Thank you\.<\/p>/);
  assert.doesNotMatch(html, /•/); // the bullet glyph is consumed into list items
});

test("emailButton renders a link with the href", () => {
  const b = emailButton("Accept", "https://x.test/a?b=1");
  assert.match(b, /href="https:\/\/x.test\/a\?b=1"/);
  assert.match(b, />Accept</);
});
