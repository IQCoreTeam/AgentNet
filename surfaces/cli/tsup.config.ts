import { defineConfig } from "tsup";

// Standalone ESM CLI. Unlike the vscode surface (CJS, needs an import.meta.url shim),
// ESM has import.meta.url natively, so the claude/codex SDKs resolve their bundled CLI
// paths fine. We only INLINE our workspace core (no node_modules at the link target);
// everything else stays a normal npm dep resolved at runtime.
export default defineConfig({
  entry: { cli: "src/index.tsx" },
  format: ["esm"],
  outDir: "dist",
  target: "node20",
  // core is a workspace package — inline it into the bundle.
  noExternal: [/@iqlabs-official\/agent-sdk/],
  // the engine SDKs spawn the user's installed CLI + resolve paths at runtime → keep external.
  external: ["@anthropic-ai/claude-agent-sdk", "@openai/codex-sdk"],
  // The inlined core pulls in CJS deps (bs58 → safe-buffer) that call require("buffer")
  // at load time. esbuild's ESM output ships a `__require` shim that THROWS unless a real
  // `require` exists in scope — so we define one via createRequire. (Also the shebang.)
  banner: {
    js: "#!/usr/bin/env node\nimport { createRequire as __ar_cr } from 'module';\nconst require = __ar_cr(import.meta.url);",
  },
});
