// Standalone stdio MCP entry, bundled by tsup into dist/mcp-stdio.cjs. Codex spawns
// this as `node <this file>` (see buildPassiveSpawn → codexMcp). Importing core's entry
// runs its main() — it bootstraps a wallet + RPC from disk and serves the read-only
// marketplace tools over stdio. Kept as a thin re-export so the bootstrap lives once,
// in core, and every surface that needs it just adds this entry to its bundler.
import "@iqlabs-official/agent-sdk/mcp-stdio";
