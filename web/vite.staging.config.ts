import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  base: "/",
  resolve: {
    alias: [{ find: /^\.\/pdf$/, replacement: fileURLToPath(new URL("./src/staging/pdf-disabled.tsx", import.meta.url)) }],
  },
  publicDir: "staging-public",
  build: {
    outDir: "../hosted/dist",
    emptyOutDir: true,
    rollupOptions: { input: "staging.html" },
  },
  plugins: [react()],
});
