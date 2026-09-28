import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  // Current hosted launch staging must never contain a learner-visible AI control.
  define: { "import.meta.env.VITE_AI_RELEASE_ENABLED": JSON.stringify("false") },
  base: "/",
  resolve: {
    alias: [{ find: /^\.\/pdf$/, replacement: fileURLToPath(new URL("./src/staging/pdf-disabled.tsx", import.meta.url)) }],
  },
  publicDir: "staging-public",
  build: {
    outDir: "../hosted/dist",
    emptyOutDir: true,
    rollupOptions: { input: ["staging.html", "app.html"] },
  },
  plugins: [react()],
});
