import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

function assertAssistantIsAbsent() {
  return {
    name: "assert-staging-assistant-is-disabled",
    generateBundle(_options: unknown, bundle: Record<string, unknown>) {
      const code = Object.values(bundle)
        .filter((item): item is { type: "chunk"; code: string } => !!item && typeof item === "object" && "type" in item && item.type === "chunk")
        .map((chunk) => chunk.code)
        .join("\n");
      const forbidden = ["/api/assistant/", "Tutor Chat", "Guided Reasoning", "Flashcard Assistant"];
      const included = forbidden.filter((text) => code.includes(text));
      if (included.length) throw new Error(`Staging bundle contains disabled assistant code: ${included.join(", ")}`);
    },
  };
}

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
  plugins: [react(), assertAssistantIsAbsent()],
});
