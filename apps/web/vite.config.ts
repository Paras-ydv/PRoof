import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In development the API runs on :3100 (3000 is often taken by other tools). Proxying keeps everything on one origin,
// so the session cookie is first-party, exactly like production.
const api = process.env.PROOF_API ?? "http://localhost:3100";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": api, "/auth": api, "/github": api },
  },
});
