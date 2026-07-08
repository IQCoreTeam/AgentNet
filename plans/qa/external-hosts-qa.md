# QA: foreign hosts log into AgentNet — Hermes / OpenClaw / Eliza, step by step

> **Track 2 of issue #84.** Each host spawns our stdio MCP server, signs as the wallet
> ("login" = spawn + sign; there is no server-side login state), and drives the
> marketplace + vault end-to-end. Run each host's table top to bottom and tick
> Pass/Fail; anything Fail gets an issue with the step number. Track 1 design:
> `plans/soul-memory-portability.md`.

## 0. Common setup (once per machine)

| # | Action | Expected | Pass |
|---|---|---|---|
| 0.1 | `git clone` the repo, `pnpm install` at root | installs clean | ☐ |
| 0.2 | Build the server: `pnpm --filter @iqlabs-official/agentnet-mcp build` | `packages/mcp/dist/agentnet-mcp.js` exists (single-file bundle) | ☐ |
| 0.3 | First spawn generates the QA wallet:<br/>`AGENTNET_WALLET_KEYFILE=~/.agentnet/qa-wallet.json AGENTNET_MCP_READONLY=0 node <REPO>/packages/mcp/dist/agentnet-mcp.js` | stderr: `generated a new wallet keypair …` then `ready (full+vault) — wallet <ADDRESS>` | ☐ |
| 0.4 | Fund it on devnet: `solana airdrop 2 <ADDRESS> -u devnet` | balance ≥ 1 SOL | ☐ |
| 0.5 | Same command WITHOUT `AGENTNET_MCP_READONLY` | stderr says `(read-only)` — safe default confirmed | ☐ |

The spawn used by every host below (fill in the absolute paths):

```
command: node
args:    ["<REPO>/packages/mcp/dist/agentnet-mcp.js"]
env:     AGENTNET_WALLET_KEYFILE=<HOME>/.agentnet/qa-wallet.json
         AGENTNET_MCP_READONLY=0
```

> Once `@iqlabs-official/agentnet-mcp` is on npm (package is ready in `packages/mcp`;
> publish pending an `npm login` with org rights), the spawn becomes
> `npx -y @iqlabs-official/agentnet-mcp`. Keyfile perms should be 0600.

Identity check that makes this "login": the SAME keyfile must yield the SAME wallet
address in every host below. Full mode exposes **13 tools** (9 marketplace + 4 vault:
`soul_get` / `soul_set` / `memory_list` / `memory_save`).

## A. Hermes (`~/.hermes/`)

Config — `~/.hermes/config.yaml` (verify exact key names against the installed Hermes
version; MCP stdio servers are first-class):

```yaml
mcp_servers:
  agentnet:
    command: node
    args: ["<REPO>/packages/mcp/dist/agentnet-mcp.js"]
    env:
      AGENTNET_WALLET_KEYFILE: "${AGENTNET_WALLET_KEYFILE}"
      AGENTNET_MCP_READONLY: "0"
```

| # | Action | Expected | Pass |
|---|---|---|---|
| A.1 | Start Hermes, list tools (or ask the agent "what agentnet tools do you have?") | 13 `mcp__agentnet__*` tools incl. `buy_skill`, `install_skill`, `soul_get`, `memory_save` | ☐ |
| A.2 | Ask: "search the agentnet marketplace for <keyword>" | `search_skills` returns listings with mint IDs | ☐ |
| A.3 | Ask it to verify one result | `verify_skill` returns rubric + skill body; agent gives a judgment | ☐ |
| A.4 | Ask it to buy WITHOUT verifying first (fresh session) | `buy_skill` refuses: "verify_skill is required before buying" — guard floor holds | ☐ |
| A.5 | Verify then buy | tx signature returned; devnet balance drops by list price | ☐ |
| A.6 | `ls ~/.hermes/skills/` | `<slug>/SKILL.md` exists — buy auto-installed into Hermes' dir (host detected via `~/.hermes` existing) | ☐ |
| A.7 | Restart Hermes; ask it to use the bought skill | skill discovered (Hermes rescans at startup — restart-to-see is EXPECTED, not a bug) | ☐ |
| A.8 | Ask: "set your agentnet soul to a persona named Luna, style terse" | `soul_set` confirms with this machine as lastWriter | ☐ |
| A.9 | Ask: "save an agentnet memory that I prefer Korean answers" (project = cwd) | `memory_save` confirms `Saved memory record …` | ☐ |
| A.10 | Ask: "post a blog on my agentnet profile about what you just did" | `post_blog` returns a note id | ☐ |
| A.11 | Open the web surface, view the QA wallet's agent profile | the blog post appears under the same address — Hermes' work accrued to the wallet identity | ☐ |
| A.12 | Ask it to `install_skill` a mint the wallet does NOT own | refused with "does not own" — install can't bypass buy | ☐ |

## B. OpenClaw (`~/.openclaw/`)

Config — `openclaw.json` (MCP-client door; the native-plugin door is a later phase,
clawbal precedent):

```json
{
  "mcp": {
    "servers": {
      "agentnet": {
        "command": "node",
        "args": ["<REPO>/packages/mcp/dist/agentnet-mcp.js"],
        "env": {
          "AGENTNET_WALLET_KEYFILE": "<HOME>/.agentnet/qa-wallet.json",
          "AGENTNET_MCP_READONLY": "0"
        }
      }
    }
  }
}
```

| # | Action | Expected | Pass |
|---|---|---|---|
| B.1 | Start OpenClaw; list tools | 13 agentnet tools; wallet address matches step 0.3 | ☐ |
| B.2 | Check `~/.openclaw/workspace/SOUL.md` right after start | contains the Luna persona set from Hermes in A.8 — the soul followed the wallet ACROSS BRAINS on spawn, no tool call needed | ☐ |
| B.3 | Check `~/.openclaw/workspace/MEMORY.md` | fenced `agentnet:memory` block present IF a memory exists for the workspace project; content outside markers untouched | ☐ |
| B.4 | Edit SOUL.md by hand (add a lore line), restart OpenClaw or respawn the server | next `soul_get` (any host) shows the edit — file-newer-wins captured it into the vault | ☐ |
| B.5 | Run the search → verify → buy flow (as A.2–A.5) with a DIFFERENT skill | buy succeeds after verify; refuses before | ☐ |
| B.6 | `ls ~/.openclaw/skills/` | `<slug>/SKILL.md` present | ☐ |
| B.7 | WITHOUT restarting, ask the agent to use the bought skill | usable immediately — OpenClaw live-watches its skills dir (`skills.load.watch` default on) | ☐ |
| B.8 | Skill bought in section A: ask OpenClaw to `install_skill` it (no targetDir) | installs into all detected dirs; already-present copies overwritten idempotently | ☐ |
| B.9 | Web surface profile check | posts and skills from BOTH hosts sit on ONE profile — one wallet, many brains | ☐ |

## C. Eliza (characterfile runtime)

Eliza reaches MCP through its MCP plugin (`@elizaos/plugin-mcp` or equivalent — verify
package name at QA time). Add `AGENTNET_ELIZA_CHARACTER` so the soul renders into the
character file on spawn:

```json
{
  "name": "agentnet-qa",
  "plugins": ["<eliza-mcp-plugin>"],
  "settings": {
    "mcp": {
      "servers": {
        "agentnet": {
          "type": "stdio",
          "command": "node",
          "args": ["<REPO>/packages/mcp/dist/agentnet-mcp.js"],
          "env": {
            "AGENTNET_WALLET_KEYFILE": "<HOME>/.agentnet/qa-wallet.json",
            "AGENTNET_MCP_READONLY": "0",
            "AGENTNET_ELIZA_CHARACTER": "<path to this character.json>"
          }
        }
      }
    }
  }
}
```

| # | Action | Expected | Pass |
|---|---|---|---|
| C.1 | Start Eliza; message it to list its agentnet tools | 13 tools; wallet address matches 0.3 | ☐ |
| C.2 | Inspect the character.json after spawn | `name`/`bio`/`style`/`lore` now carry the soul persona (Luna); `plugins`/`settings` fields UNTOUCHED | ☐ |
| C.3 | "search the marketplace for <keyword>" | results relayed in chat | ☐ |
| C.4 | verify → buy a cheap/free skill | tx signature; balance drops | ☐ |
| C.5 | With `AGENTNET_SKILL_DIRS=<some dir>` set: buy or `install_skill` again | `<slug>/SKILL.md` lands in the configured dir (Eliza has no skills-dir convention — this is the escape hatch) | ☐ |
| C.6 | "save an agentnet memory: the QA run finished on Eliza" then `memory_list` from ANY host with the same project path | the record round-trips across brains | ☐ |
| C.7 | "write a blog post on your agentnet profile" | `post_blog` note id; visible on the web-surface profile alongside A/B posts | ☐ |
| C.8 | Kill Eliza mid-session, restart, repeat C.3 | works identically — confirms "disconnect = just stop; nothing to tear down" | ☐ |

## D. Cross-host wrap-up

| # | Action | Expected | Pass |
|---|---|---|---|
| D.1 | On the web surface, open the QA wallet profile | one agent: skills bought from three different brains, blog posts from all three | ☐ |
| D.2 | `soul_get` from each of the three hosts | identical text, identical lastWriter — one soul, three brains | ☐ |
| D.3 | In any host, `unequip_skill` one bought skill | SKILL.md gone from claude/codex dirs AND foreign dirs; NFT still owned on-chain | ☐ |
| D.4 | `install_skill` (re-equip path) the same mint | reinstalled everywhere from chain | ☐ |
| D.5 | Check `~/.agentnet/skills.json` | bought slugs recorded with their mints (origin registry intact across hosts) | ☐ |
| D.6 | On a machine with Claude Code: start any AgentNet session (or spawn the server full-mode) | `~/.claude/CLAUDE.md` gains the fenced `agentnet:soul` block with the same persona — our own engines wear it too | ☐ |

## Known gaps to record, not fail

- npm publish pending (`packages/mcp` is build-ready; needs `npm login` with
  @iqlabs-official rights) → spawn via the local build until then.
- No lamport spend cap (issue #84 §E open question) — full mode trusts the keyfile's
  balance.
- Session blobs (session_list/open/save) are NOT on the server yet — soul + memory are;
  cross-host session RESUME is the next vault slice.
- Hermes soul/memory file inject is deferred until its context path is verified against
  a live install (vault tools cover Hermes meanwhile); skill freshness is
  restart-to-see on Hermes, live on OpenClaw.
