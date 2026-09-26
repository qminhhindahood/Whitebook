import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/app/",
  build: {
    chunkSizeWarningLimit: 700,
  },
  plugins: [react()],
});
