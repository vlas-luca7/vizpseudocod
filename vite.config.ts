import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  // Project site: https://<user>.github.io/vizpseudocod/
  base: "/vizpseudocod/",
  plugins: [react()],
});
