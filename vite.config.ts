import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { readdirSync, writeFileSync } from "node:fs";

function offlineShellPlugin(): Plugin {
  return {
    name: "offline-shell",
    apply: "build",
    closeBundle() {
      const distPath = path.resolve(import.meta.dirname, "dist");
      const files = readdirSync(distPath, { recursive: true })
        .filter((file): file is string => typeof file === "string")
        .filter((file) => file !== "sw.js")
        .map((file) => `./${file.replace(/\\/g, "/")}`);
      const worker = `const CACHE = "stockura-shell-v1";
const ASSETS = ${JSON.stringify(["./", "./index.html", ...files])};
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))));
  self.clients.claim();
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then((response) => {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put("./index.html", copy));
      return response;
    }).catch(() => caches.match("./index.html")));
    return;
  }
  if (!["script", "style", "image", "font", "worker", "manifest"].includes(request.destination)) return;
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
    if (response.ok) caches.open(CACHE).then((cache) => cache.put(request, response.clone()));
    return response;
  })));
});`;
      writeFileSync(path.join(distPath, "sw.js"), worker, "utf8");
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const supabaseUrl = env.VITE_SUPABASE_URL ?? "";
  const supabaseKey =
    env.VITE_SUPABASE_PUBLISHABLE_KEY ?? env.VITE_SUPABASE_ANON_KEY ?? "";
  if (
    mode === "production" &&
    (!supabaseUrl.startsWith("https://") ||
      !supabaseKey ||
      /your_supabase|placeholder|your_/i.test(`${supabaseUrl} ${supabaseKey}`))
  ) {
    throw new Error(
      "Production builds require a valid HTTPS VITE_SUPABASE_URL and publishable/anon key.",
    );
  }

  return {
  base: "./",
  plugins: [react(), tailwindcss(), offlineShellPlugin()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: parseInt(process.env.PORT || "8443"),
    strictPort: true,
  },
  preview: {
    host: "0.0.0.0",
    port: parseInt(process.env.PORT || "8443"),
  },
  build: {
    // Splits CSS styles per component instead of shipping one giant stylesheet
    cssCodeSplit: true,
    // Instructs the bundler how to separate code fragments cleanly
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Packs heavy third-party framework code into its own cached file
          if (id.includes("node_modules")) {
            if (
              id.includes("react") ||
              id.includes("react-dom") ||
              id.includes("react-router")
            ) {
              return "vendor-core";
            }
            if (id.includes("lucide-react")) {
              return "vendor-icons";
            }
            return "vendor-libs"; // Captures everything else (uuid, crypto-fallbacks, etc.)
          }
        },
      },
    },
    chunkSizeWarningLimit: 600, // Adjusts baseline threshold gracefully
  },
  };
});
