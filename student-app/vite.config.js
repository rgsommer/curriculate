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
    // Raise the warning threshold a little so incidental overages don't noise the log.
    // The manualChunks below keep the actual main chunk well under 500 kB.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      external: [], // Ensure dnd is not externalized
      output: {
        globals: {}, // No globals needed for dnd
        /**
         * Split heavy vendor code into separate async chunks.
         * Each chunk is loaded only when the module is first needed,
         * so the initial JS payload is much smaller.
         *
         * Current total: ~1 643 kB → target main chunk ≤ 500 kB
         */
        manualChunks(id) {
          // React + ReactDOM — tiny, always needed, bundle together
          if (id.includes("node_modules/react/") || id.includes("node_modules/react-dom/")) {
            return "vendor-react";
          }

          // Animation / visual effects (framer-motion, lottie, confetti)
          if (
            id.includes("node_modules/framer-motion/") ||
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

          // Socket.io client
          if (id.includes("node_modules/socket.io-client/") || id.includes("node_modules/engine.io-client/")) {
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
