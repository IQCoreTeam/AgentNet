import { defineConfig } from "tsup";

// The publishable stdio entry (issue #84): one self-contained file so
// `npx -y @iqlabs-official/agentnet-mcp` works with zero peer installs. Everything is
// inlined — including our workspace core, which isn't on npm — which is exactly why
// core's skill-market/index.ts must never import the Claude Agent SDK (that bridge
// lives in skill-market/sdk.ts, outside this entry's import graph).
//
// CJS, not ESM: the solana dep tree is full of CJS modules requiring node builtins
// ("buffer" via safe-buffer/bs58), which esbuild's ESM output turns into a throwing
// dynamic __require. CJS handles them natively — same trade the vscode surface makes,
// including its import.meta.url shim for any ESM code that got inlined.
export default defineConfig({
  entry: { "agentnet-mcp": "../core/src/mcp-stdio.ts" },
  format: ["cjs"],
  outDir: "dist",
  platform: "node",
  target: "node18",
  noExternal: [/.*/],
  define: { "import.meta.url": "importMetaUrl" },
  banner: {
    js: "#!/usr/bin/env node\nconst { pathToFileURL } = require('node:url'); const importMetaUrl = pathToFileURL(__filename).href;",
  },
  clean: true,
});
