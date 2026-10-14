// Undeclared identifiers, in the files where one would reach production.
//
// Twice in one week a reference to a variable that was never declared went
// out on a push:
//
//   - key-review JSX naming five identifiers that did not exist, which
//     crashed the grading page;
//   - `openEnded` in /grading/mark-paper, referenced twice and declared
//     nowhere, which turned every call into a 500 and sent every paper to
//     the fallback grader. It ran for a day before anyone noticed, because
//     the fallback works.
//
// Both passed `node --check` and both passed tsc, because an undeclared
// identifier is a ReferenceError at run time and neither tool looks for
// one. ESLint's no-undef does, and it finds them in well under a second.
//
//   node backend/tests/check-no-undef.mjs
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// The server, and the grading pages it serves. Not the whole repo: this is
// a guard on the paths that mark a child's work, and it has to stay fast
// enough to run before every push.
const TARGETS = [
  "backend/index.js",
  "backend/utils",
  "backend/routes",
  "frontend/src/app/grading",
];

// Globals the runtimes provide. A name missing from here reads as a fault,
// so the list is deliberately generous — the bug this catches is a local
// that was never declared, not a platform global nobody has heard of.
const NODE = ["process", "console", "Buffer", "__dirname", "__filename", "setTimeout",
  "clearTimeout", "setInterval", "clearInterval", "setImmediate", "clearImmediate",
  "URL", "URLSearchParams", "TextEncoder", "TextDecoder", "fetch", "Response",
  "Request", "Headers", "FormData", "Blob", "File", "AbortController", "AbortSignal",
  "crypto", "structuredClone", "global", "globalThis", "queueMicrotask", "performance",
  "atob", "btoa", "ReadableStream", "WritableStream", "TransformStream", "Intl",
  "WebSocket", "MessageChannel", "Event", "EventTarget", "require", "module", "exports"];

const BROWSER = ["window", "document", "navigator", "location", "history", "screen",
  "localStorage", "sessionStorage", "indexedDB", "alert", "confirm", "prompt",
  "FileReader", "Image", "Audio", "MediaRecorder", "DataTransfer", "ClipboardItem",
  "requestAnimationFrame", "cancelAnimationFrame", "matchMedia", "getComputedStyle",
  "ResizeObserver", "IntersectionObserver", "MutationObserver", "HTMLElement",
  "CustomEvent", "XMLHttpRequest", "Notification", "speechSynthesis",
  "SpeechSynthesisUtterance", "CanvasRenderingContext2D", "DOMParser", "Worker",
  "SpeechRecognition", "webkitSpeechRecognition", "React", "DOMException",
  "OffscreenCanvas", "ImageData", "AudioContext", "webkitAudioContext", "Element"];

const globals = Object.fromEntries([...NODE, ...BROWSER].map((g) => [g, "readonly"]));

const config = `export default [
  // Archived copies kept beside the live file — "_pageWorkingFeb11_419.jsx"
  // — are not served and are full of names their live versions dropped.
  { ignores: ["**/_*.js", "**/_*.jsx", "**/*.bak.*", "**/node_modules/**"] },
  {
    files: ["**/*.js", "**/*.jsx", "**/*.mjs"],
    // Inline disable comments name plugin rules this config does not load,
    // and an unknown rule is itself an error. Only no-undef is wanted here.
    linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "off" },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: ${JSON.stringify(globals)},
    },
    rules: { "no-undef": "error" },
  },
];`;

const { writeFileSync, rmSync } = await import("node:fs");
const cfg = path.join(repo, "backend", "tests", ".no-undef.config.mjs");
writeFileSync(cfg, config);
try {
  const r = spawnSync("npx", ["--no-install", "eslint", "--quiet", "--no-config-lookup", "-c", cfg, ...TARGETS],
    { cwd: repo, encoding: "utf8" });
  const out = `${r.stdout || ""}${r.stderr || ""}`.trim();
  if (r.status === 0) {
    console.log(`no undeclared identifiers in ${TARGETS.join(", ")}`);
    process.exit(0);
  }
  console.log(out || "eslint failed with no output");
  console.log("\nEach line above is a name used but never declared — a ReferenceError");
  console.log("the moment that line runs. node --check and tsc both pass these.");
  process.exit(1);
} finally {
  rmSync(cfg, { force: true });
}
