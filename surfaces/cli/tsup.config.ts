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
  // stale chunks from previous builds must never ship (files:["dist"] publishes everything).
  clean: true,
  // core is a workspace package — inline it into the bundle.
  noExternal: [/@iqlabs-official\/agent-sdk/],
  // the claude SDK spawns the user's installed CLI + resolves paths at runtime → keep external.
  // (codex is driven via `codex app-server --stdio` directly, no SDK dep.)
  external: ["@anthropic-ai/claude-agent-sdk"],
  // The inlined core pulls in CJS deps (bs58 → safe-buffer) that call require("buffer")
  // at load time. esbuild's ESM output ships a `__require` shim that THROWS unless a real
  // `require` exists in scope — so we define one via createRequire. (Also the shebang.)
  // @coral-xyz/anchor's ESM dist also has a bare `exports.workspace = ...`/`exports.Wallet =
  // ...` (its Node-only "workspace" convenience global, guarded by `if (!isBrowser)`) that
  // assumes a real CJS `exports` binding — bundled into pure ESM there is none, so it throws
  // `exports is not defined` the moment anything imports from anchor. Nothing in this CLI
  // reads that global, so a throwaway module-scope `exports` object is a harmless sink.
  // A native-addon loader (the `bindings` package, reached from bigint-buffer's fallback
  // path) also references bare `__filename` to identify its own call site — another CJS
  // global with no ESM equivalent. Standard esbuild-recommended shim: derive it from
  // import.meta.url. Approximate (one shared value for the whole bundle, not per-original-
  // file), but this call site only uses it to fail its native-binding lookup gracefully
  // (already-tolerated: see the "bigint: Failed to load bindings" warning on every launch).
  // Last line: node's punycode DeprecationWarning (whatwg-url inside the inlined core,
  // reached from node-fetch) fires while the dependency chunks evaluate, BEFORE any src
  // code runs: ESM hoisting executes cli.js's chunk imports ahead of its body, so even
  // the first statement of index.tsx is too late and the 122-col warning hits the raw
  // terminal, wrapping to several rows on narrow windows. This banner is the one piece
  // of code that runs earlier (it is prepended to every output file, and the first file
  // to evaluate runs it before any bundled module code), so it swaps node's default
  // stderr printer for a handler that appends every process warning to
  // ~/.agentnet/cli-debug.log, the same file quietDiagnosticsToFile in index.tsx uses,
  // so nothing is silently lost. Warnings only: errors are untouched. AGENTNET_DEBUG
  // keeps the default terminal printing, same escape hatch as the console redirect.
  banner: {
    js: "#!/usr/bin/env node\nimport { createRequire as __ar_cr } from 'module';\nimport { fileURLToPath as __ar_ftp } from 'url';\nimport { dirname as __ar_dn } from 'path';\nconst require = __ar_cr(import.meta.url);\nconst exports = {};\nconst __filename = __ar_ftp(import.meta.url);\nconst __dirname = __ar_dn(__filename);\nif (!process.env.AGENTNET_DEBUG) { const __ar_w = console.warn.bind(console); console.warn = (...a) => { if (typeof a[0] === 'string' && a[0].startsWith('bigint: Failed to load bindings')) return; __ar_w(...a); }; }\nif (!process.env.AGENTNET_DEBUG && !globalThis.__agentnetWarningsToLog) { globalThis.__agentnetWarningsToLog = true; process.removeAllListeners('warning'); process.on('warning', (w) => { try { const fs = require('fs'); const path = require('path'); const dir = path.join(require('os').homedir(), '.agentnet'); fs.mkdirSync(dir, { recursive: true }); fs.appendFileSync(path.join(dir, 'cli-debug.log'), '[' + new Date().toISOString() + '] warning: ' + (w.code ? '[' + w.code + '] ' : '') + w.name + ': ' + w.message + '\\n'); } catch {} }); }",
  },
});
