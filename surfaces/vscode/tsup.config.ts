import { defineConfig } from "tsup";

// VSCode extensions load as CommonJS, but the claude/codex SDKs are ESM and use
// `import.meta.url` (via createRequire) to locate their bundled CLI binaries. When
// esbuild emits CJS, `import.meta.url` becomes undefined → "filename must be a file
// URL" on activation. We shim it in a banner so the bundled SDK code resolves paths
// against THIS file instead. (`require`/__filename exist in the CJS extension host.)
export default defineConfig({
  // extension.ts → the VSCode extension; mcp-stdio.ts → a standalone stdio MCP server
  // Codex spawns as a child process (dist/mcp-stdio.js). Both CJS, core inlined.
  entry: ["src/extension.ts", "src/mcp-stdio.ts"],
  format: ["cjs"],
  outDir: "dist",
  external: ["vscode"],
  // our core is a workspace package, not a real npm dep — it must be INLINED into the
  // single extension bundle (the runtime has no node_modules at the link target).
  // (The claude/codex SDKs stay external: the SDK code is dynamically resolved at
  // runtime and spawns the user's installed CLI, so it shouldn't be inlined.)
  noExternal: [/@iqlabs-official\/agent-sdk/],
  // map import.meta.url → the running file's URL so SDK path resolution works in CJS.
  // Also bake the Google OAuth client creds at build time (like Android's BuildConfig) so
  // gdrive works in the SHIPPED extension — VS Code gets no shell env and no config.json, so
  // without this clientId() always throws "Google client id missing". Sourced from the build
  // env (the publish script / CI), never committed; empty when unset → clientId()/clientSecret()
  // fall back to ~/.agentnet/config.json, so a dev with local creds is unaffected.
  define: {
    "import.meta.url": "importMetaUrl",
    "process.env.GOOGLE_CLIENT_ID": JSON.stringify(process.env.GOOGLE_CLIENT_ID || ""),
    "process.env.GOOGLE_CLIENT_SECRET": JSON.stringify(process.env.GOOGLE_CLIENT_SECRET || ""),
  },
  banner: {
    js: "const { pathToFileURL } = require('node:url'); const importMetaUrl = pathToFileURL(__filename).href;",
  },
});
