import { defineConfig } from "tsup";

// The server runs on plain Node as ESM (top-level await, import.meta.url native).
// Unlike the vscode bundle (which sits next to a node_modules), this bundle runs in a
// proot rootfs that has NO node_modules — so EVERY npm dep must be INLINED, or node
// dies at startup with ERR_MODULE_NOT_FOUND (e.g. `ws`, pulled in transitively by
// @solana/web3.js → rpc-websockets). Hence noExternal: everything.
//
// The two exceptions are the agent SDKs: they don't run in-process, they `which` and
// spawn the user's installed claude/codex CLI, and they resolve their own helper paths
// via import.meta — bundling them would break that. They're installed into the rootfs
// separately (see surfaces/android/scripts/build-assets.sh), so leaving them external
// is correct: at runtime node finds them on the guest's module path.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  outDir: "dist",
  target: "node20",
  noExternal: [/(?!^@anthropic-ai\/claude-agent-sdk$|^@openai\/codex-sdk$).*/],
  external: ["@anthropic-ai/claude-agent-sdk", "@openai/codex-sdk"],
  // core inlines transitive CJS deps (bs58 → base-x → safe-buffer) that call
  // require("buffer") at load. esbuild's ESM output has no `require`, so those throw
  // "Dynamic require not supported". Re-create a real `require` from import.meta.url
  // in a banner so the inlined CJS modules resolve Node built-ins natively.
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
});
