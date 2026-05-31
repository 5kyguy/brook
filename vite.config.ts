import { execSync } from "node:child_process";
import path from "node:path";
import { defineConfig } from "vite";
import svgUse from "./frontend/vite-plugin-svg-use";

function gitCommit(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "dev";
  }
}

export default defineConfig({
  root: "frontend",
  base: "./",
  clearScreen: false,
  publicDir: "public",
  define: {
    __GIT_COMMIT__: JSON.stringify(gitCommit()),
  },
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
