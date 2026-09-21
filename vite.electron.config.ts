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
import electron from "vite-plugin-electron";
import renderer from "vite-plugin-electron-renderer";
import path from "path";

// Banner to recreate __filename and __dirname in ES module scope
const esmBanner = `import { fileURLToPath as _fileURLToPath } from "node:url"; import { dirname as _dirname } from "node:path"; const __filename = _fileURLToPath(import.meta.url); const __dirname = _dirname(__filename);`;

export default defineConfig({
  base: "./",
  plugins: [
    react(),
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
            rollupOptions: {
              external: ["electron"],
              output: {
                banner: esmBanner,
              },
            },
          },
        },
      },
      {
        entry: "desktop/preload.ts",
        onstart(args) {
          args.reload();
        },
        vite: {
          build: {
            sourcemap: "inline",
            minify: false,
            outDir: "desktop/dist",
            rollupOptions: {
              external: ["electron"],
              output: {
                banner: esmBanner,
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
