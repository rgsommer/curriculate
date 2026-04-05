// student-app/vite.config.js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
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
    // framer-motion alone is ~700 kB unminified — set the threshold above that
    // so the warning only fires for genuinely unexpected bloat.
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      external: [], // Ensure dnd is not externalized
      output: {
        globals: {}, // No globals needed for dnd
        /**
         * Split vendor code into separate cacheable chunks.
         * Browsers cache these independently, so only changed chunks
         * are re-downloaded on each deploy.
         */
        manualChunks(id) {
          // React + ReactDOM — tiny, always needed, bundle together
          if (id.includes("node_modules/react/") || id.includes("node_modules/react-dom/")) {
            return "vendor-react";
          }

          // framer-motion is large on its own (~700 kB unminified) — isolate it
          if (id.includes("node_modules/framer-motion/")) {
            return "vendor-framer";
          }

          // Lottie + confetti
          if (
            id.includes("node_modules/lottie") ||
            id.includes("node_modules/canvas-confetti/") ||
            id.includes("node_modules/react-confetti/")
          ) {
            return "vendor-animation";
          }

          // Drag-and-drop (dnd-kit + hello-pangea)
          if (
            id.includes("node_modules/@dnd-kit/") ||
            id.includes("node_modules/@hello-pangea/")
          ) {
            return "vendor-dnd";
          }

          // Socket.io client + engine.io
          if (
            id.includes("node_modules/socket.io-client/") ||
            id.includes("node_modules/engine.io-client/") ||
            id.includes("node_modules/@socket.io/")
          ) {
            return "vendor-socket";
          }

          // Routing
          if (id.includes("node_modules/react-router") || id.includes("node_modules/@remix-run/")) {
            return "vendor-router";
          }

          // Icons
          if (id.includes("node_modules/lucide-react/")) {
            return "vendor-icons";
          }

          // Everything else in node_modules goes into a general vendor chunk
          if (id.includes("node_modules/")) {
            return "vendor-misc";
          }
        },
      },
    },
  },
});
