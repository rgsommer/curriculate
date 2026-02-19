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
    rollupOptions: {
      external: [], // Ensure dnd is not externalized
      output: {
        globals: {}, // No globals needed for dnd
      },
    },
  },
});
