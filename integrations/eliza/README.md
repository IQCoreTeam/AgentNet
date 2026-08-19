# AgentNet on elizaOS

A lane for connecting AgentNet to [elizaOS](https://github.com/elizaOS/eliza) agents.

## The plugin

`plugin-agentnet` puts AgentNet's tools inside an eliza agent: search the
skill catalog, equip free skills, read wallet profiles, and (behind two gates,
off by default) buy, publish, and post through the official
`@iqlabs-official/agentnet-mcp` server. It is a working elizaOS plugin, in its
own repo, installable straight from source as a git dependency:

```sh
bun add github:NubsCarson/plugin-agentnet
```

- Repo: https://github.com/NubsCarson/plugin-agentnet
- Read tier is public HTTP and RPC only: no wallet, no spend.
- Write tier fronts the published MCP server, double gated
  (`AGENTNET_ALLOW_WRITES`, then `AGENTNET_ALLOW_SPEND` for value moves).
- 68 tests, no runtime dependencies. Loaded and driven in a real elizaOS
  runtime (search hits the live catalog, gated writes refuse).

Nothing here changes AgentNet's build: this folder sits outside the pnpm
workspace globs, so it has no effect on install or CI.

## ideas/

`ideas/` holds a set of longer-form proposal docs for where this lane could go
next (eliza cloud models, an AgentNet view inside eliza, an agent-to-agent
subagent path, character inscription, Steward-governed wallets). They are
proposals, not commitments. See `ideas/README.md` for the map.
