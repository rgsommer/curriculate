// student-app/vite.config.js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { execSync } from "child_process";

// Stamp the build with the git commit + time so we can confirm — from the
// browser console on play.curriculate.net — exactly which code is live. This
// settles "is the deploy actually serving the latest bundle?" questions.
let __commit = "unknown";
try { __commit = execSync("git rev-parse --short HEAD").toString().trim(); } catch { /* detached / no .git */ }
if (!__commit || __commit === "unknown") {
  __commit = (process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 7) || "unknown";
}
const __buildTime = new Date().toISOString();

export default defineConfig({
  define: {
    __BUILD_COMMIT__: JSON.stringify(__commit),
    __BUILD_TIME__: JSON.stringify(__buildTime),
  },
  plugins: [react()],
  server: {
    port: 5174, // different port so both can run at once
  },
  base: "/",
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "../shared"),
      // Force a single React instance (prevents "Invalid hook call"/minified React error #321)
      react: path.resolve(__dirname, "./node_modules/react"),
      "react-dom": path.resolve(__dirname, "./node_modules/react-dom"),
      // Use lottie's light build — same API, no eval, smaller (~40 % smaller)
      "lottie-web": path.resolve(
        __dirname,
        "./node_modules/lottie-web/build/player/lottie_light.js"
      ),
    },
    dedupe: ["react", "react-dom"],
  },
  optimizeDeps: {
    include: [
      "@hello-pangea/dnd",
      "react",
      "react-dom",
    ],
  },
  build: {
    // Raise the warning threshold — framer-motion alone is ~700 kB unminified.
    // Manual chunk splitting caused TDZ circular-reference crashes in production;
    // Vite's automatic chunking is safer and handles internal cross-references correctly.
    chunkSizeWarningLimit: 800,
  },
});
