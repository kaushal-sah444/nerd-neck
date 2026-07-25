// vitest/config re-exports Vite's defineConfig with the `test` block typed.
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // Relative asset paths, so the same build works at a domain root, in a
  // /repo-name/ subpath on GitHub Pages, or opened from the filesystem. Safe
  // here because the app is a single page with no client-side router.
  base: "./",
  plugins: [react(), tailwindcss()],
  server: {
    // getUserMedia requires a secure context. localhost counts as secure, so
    // `npm run dev` works as-is; opening the LAN address on a phone will not
    // unless you serve over HTTPS.
    host: "localhost",
    port: 5173,
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
