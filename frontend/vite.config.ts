import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // The online demo is served from a sub-path on GitHub Pages: use relative asset URLs.
  base: process.env.VITE_STATIC_DEMO === "1" ? "./" : "/",
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:8000" } },
  build: {
    rollupOptions: {
      output: {
        // Charts and React are big and change rarely: separate cacheable chunks.
        manualChunks: { charts: ["recharts"], react: ["react", "react-dom", "react-router-dom"] },
      },
    },
  },
});
