import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

const host = process.env.TAURI_DEV_HOST;
const API_TARGET = process.env.VITE_API_TARGET || "http://<backend-host>:8280";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: {
      ignored: ["**/src-tauri/**", "**/.trash-stray/**", "**/node_modules/**"],
    },
    fs: {
      strict: true,
      allow: [
        resolve(__dirname, "src"),
        resolve(__dirname, "node_modules"),
        resolve(__dirname, "index.html"),
      ],
    },
    // 把 /api 反向代理到後端，避開 macOS WKWebView ATS（不能直連 plain HTTP）
    proxy: {
      "/api": {
        target: API_TARGET,
        changeOrigin: true,
        ws: true,
      },
    },
  },
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
  envPrefix: ["VITE_", "TAURI_"],
  optimizeDeps: {
    entries: ["src/main.tsx"],
    include: [
      "react", "react-dom", "react-dom/client",
      "react-virtuoso", "react-markdown",
      "remark-gfm", "remark-math",
      "rehype-highlight", "rehype-katex", "rehype-raw",
      "zustand", "idb",
    ],
  },
  build: {
    target: "es2021",
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
});
