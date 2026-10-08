// import { defineConfig } from "vite";
// import react from "@vitejs/plugin-react";
// import electron from "vite-plugin-electron";
// import renderer from "vite-plugin-electron-renderer";
// import path from "path";

// export default defineConfig({
//   base: "./",
//   plugins: [
//     react(),
//     electron([
//       {
//         entry: "desktop/main.ts",
//         onstart(args) {
//           args.reload();
//         },
//         vite: {
//           build: {
//             sourcemap: true,
//             minify: false,
//             outDir: "desktop/dist",
//             rollupOptions: {
//               external: ["electron"],
//             },
//           },
//         },
//       },
//       {
//         entry: "desktop/preload.ts",
//         onstart(args) {
//           args.reload();
//         },
//         vite: {
//           build: {
//             sourcemap: "inline",
//             minify: false,
//             outDir: "desktop/dist",
//             rollupOptions: {
//               external: ["electron"],
//             },
//           },
//         },
//       },
//     ]),
//     // Use Node.js API in the Renderer-process
//     renderer(),
//   ],
//   resolve: {
//     alias: {
//       "@": path.resolve(__dirname, "./src"),
//     },
//   },
//   optimizeDeps: {
//     exclude: ["lucide-react"],
//   },
//   clearScreen: false,
// });

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import electron from "vite-plugin-electron";
import renderer from "vite-plugin-electron-renderer";
import path from "path";

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    tailwindcss(),
    electron([
      {
        entry: "desktop/main.ts",
        onstart(args) {
          args.reload();
        },
        vite: {
          build: {
            sourcemap: true,
            minify: false,
            outDir: "desktop/dist",
            rolldownOptions: {
              external: ["electron"],
              output: {
                format: "es",
              },
            },
          },
        },
      },
      {
        entry: "desktop/preload.mts",
        onstart(args) {
          args.reload();
        },
        vite: {
          build: {
            sourcemap: "inline",
            minify: false,
            outDir: "desktop/dist",
            lib: {
              formats: ["es"],
              fileName: () => "preload.mjs",
            },
            rolldownOptions: {
              external: ["electron"],
              output: {
                format: "es",
              },
            },
          },
        },
      },
    ]),
    // Use Node.js API in the Renderer-process
    renderer(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(process.cwd(), "./src"),
    },
  },
  optimizeDeps: {
    exclude: ["lucide-react"],
  },
  clearScreen: false,
});
