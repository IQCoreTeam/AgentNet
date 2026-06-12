import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// This SPA is the screen an Android WebView loads — not a hosted web service. The build
// output (dist/) is what the Android shell embeds and points its WebView at; it talks to
// the local node (surfaces/localhost) over HTTP. base: "./" makes every asset URL
// relative so the bundle works under the WebView's origin (127.0.0.1/file) unchanged.
// The dev server proxies /events + /rpc to a running surfaces/localhost (port 4317) so
// `vite dev` can drive a real core in a desktop browser while building the UI.
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    proxy: {
      "/events": { target: "http://localhost:4317", changeOrigin: true },
      "/rpc": { target: "http://localhost:4317", changeOrigin: true },
    },
  },
});
