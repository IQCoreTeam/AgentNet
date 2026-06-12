import { defineConfig } from "tsup";

// The server runs on plain Node as ESM (top-level await, import.meta.url native).
// Like the vscode bundle, our core is a workspace package, not a real npm dep, so it
// must be INLINED — but the claude/codex SDKs stay external (resolved at runtime,
// they spawn the user's installed CLI). `ws` is a real dep, left external too.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  outDir: "dist",
  target: "node20",
  noExternal: [/@iqlabs-official\/agent-sdk/],
  // core inlines transitive CJS deps (bs58 → base-x → safe-buffer) that call
  // require("buffer") at load. esbuild's ESM output has no `require`, so those throw
  // "Dynamic require not supported". Re-create a real `require` from import.meta.url
  // in a banner so the inlined CJS modules resolve Node built-ins natively.
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
});
