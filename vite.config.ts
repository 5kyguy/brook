import path from "node:path";
import { defineConfig } from "vite";
import svgUse from "./frontend/vite-plugin-svg-use";

export default defineConfig({
  root: "frontend",
  base: "./",
  clearScreen: false,
  publicDir: "public",
  resolve: {
    alias: [
      { find: "!lucide", replacement: path.resolve(__dirname, "node_modules/lucide-static/icons") },
      { find: /^!lucide\/(.+)$/, replacement: path.resolve(__dirname, "node_modules/lucide-static/icons") + "/$1" },
    ],
  },
  server: {
    port: 5173,
    strictPort: true,
    fs: {
      allow: ["..", path.resolve(__dirname, "node_modules")],
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  plugins: [svgUse()],
});
