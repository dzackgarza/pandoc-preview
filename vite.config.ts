import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";

// Port 1420 is the fixed Tauri dev port declared in src-tauri/tauri.conf.json.
export default defineConfig({
  plugins: [tailwindcss(), svelte()],
  clearScreen: false,
  // Surface the E2E proof gate to the client bundle. Set only by
  // scripts/proof-run.sh (VITE_PPE_E2E=1); a normal `bun run dev`/build leaves
  // it undefined, so the test harness in App.svelte is never attached.
  define: {
    "import.meta.env.VITE_PPE_E2E": JSON.stringify(process.env.VITE_PPE_E2E ?? ""),
  },
  server: {
    port: 1420,
    strictPort: true,
  },
});
