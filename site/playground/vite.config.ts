import { defineConfig } from "vite";
import solid from "@solidjs/vite-plugin";

export default defineConfig({
  plugins: [solid()],
  server: { port: 3020, strictPort: true },
  // the hover worker's: found on the first hover otherwise, and the dev server reloads the page for it
  optimizeDeps: { include: ["typescript"] },
  build: { target: "esnext" },
});
