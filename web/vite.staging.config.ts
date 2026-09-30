import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  // The staging AI release is explicitly enabled for the hosted rehearsal.
  define: { "import.meta.env.VITE_AI_RELEASE_ENABLED": JSON.stringify("true") },
  base: "/",
  resolve: {
    alias: [{ find: /^\.\/pdf$/, replacement: fileURLToPath(new URL("./src/staging/pdf-disabled.tsx", import.meta.url)) }],
  },
  publicDir: "staging-public",
  build: {
    outDir: "../hosted/dist",
    emptyOutDir: false,
    rollupOptions: { input: ["staging.html", "app.html"] },
  },
  plugins: [react()],
});
