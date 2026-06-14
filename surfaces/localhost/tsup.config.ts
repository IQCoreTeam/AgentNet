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
  //
  // `exports` shim: @coral-xyz/anchor's ESM dist assigns `exports.workspace` / `.Wallet`
  // inside an `__esm` lazy-init block when !isBrowser — `exports` is not defined in ESM
  // scope, causing a ReferenceError at startup. A top-level `exports = {}` makes those
  // assignments succeed harmlessly (anchor's workspace API is unused by agentnet).
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; import { fileURLToPath as __futp } from 'node:url'; import { dirname as __dn } from 'node:path'; const require = __cr(import.meta.url); const exports = {}; const __filename = __futp(import.meta.url); const __dirname = __dn(__filename);",
  },
});
