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
    // Raise the warning threshold — framer-motion alone is ~700 kB unminified.
    // Manual chunk splitting caused TDZ circular-reference crashes in production;
    // Vite's automatic chunking is safer and handles internal cross-references correctly.
    chunkSizeWarningLimit: 800,
  },
});
