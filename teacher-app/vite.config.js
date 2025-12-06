// teacher-app/vite.config.js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  base: "/",
  resolve: {
    alias: {
      // This lets you import from shared folder like:
      // import { COPY } from "@shared/config/copy";
      "@shared": path.resolve(__dirname, "../shared"),
    },
  },
});