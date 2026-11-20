import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { qaNewsApiPlugin } from "./server/vite-plugin.mjs";

export default defineConfig({
  plugins: [react(), tsconfigPaths(), qaNewsApiPlugin()],
  server: {
    host: true,
    port: 5173,
  },
});
