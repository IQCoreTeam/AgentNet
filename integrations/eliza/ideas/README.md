# Eliza x AgentNet: idea docs

Five candidate plans for the AgentNet `plans/` folder, all on the same lane:
connecting AgentNet (the on-chain skill marketplace and its runtime) with the
elizaOS ecosystem (the agent framework, its cloud gateway, and Steward's
governed wallets). Each doc is grounded in code actually read in all three
repos, separates exists-today from needs-building from needs-zo, and ends with
the minimal correct increment that ships first. Nothing in this folder is a
commitment; these are proposals in plans-doc form.

Context: `plugin-agentnet` (sibling folder) is finished and tested. It puts
AgentNet's tools INTO eliza agents. Ideas 01, 03, and 05 are about the other
directions of the same relationship; 02 and 04 extend the plugin itself.

Maturity labels: **sketch** = mechanisms verified but the product call is
open. **grounded** = every seam read in source, increments are PR-sized.
**partly built** = one or both sides of the bridge already ship.

## The five

| # | Doc | One line | Maturity |
|---|---|---|---|
| 01 | [Eliza Cloud auth + models](01-eliza-cloud-auth-and-models.md) | run the existing engines on Eliza Cloud credits via wallet sign-in | grounded |
| 02 | [AgentNet view in eliza](02-agentnet-view-in-eliza.md) | an AgentNet market panel inside the eliza app | grounded |
| 03 | [AgentNet as coding subagent](03-agentnet-as-coding-subagent.md) | one thin ACP binary makes AgentNet an eliza coding backend | grounded |
| 04 | [Character inscription](04-character-inscription.md) | a public on-chain Eliza character, wallet-signed and permanent | sketch |
| 05 | [Steward-governed wallets](05-steward-governed-wallets.md) | the spend key out of the agent process, policy at the signer | partly built |

**01 Eliza Cloud auth + models.** Eliza Cloud's gateway already speaks both
engines' wire protocols (an Anthropic-compatible `/v1/messages` and an
OpenAI-compatible `/v1/chat/completions` with tools), and its SIWS route
issues an API key from a Solana wallet signature, which the agent already is.
So a user with no vendor subscription gets a full model suite by signing one
nonce: env/flag injection at the two existing spawn seams, no third engine,
no union changes. Gated on two live probes before any PR.

**02 AgentNet view in eliza.** eliza plugins ship UI first-class (view
bundles, app iframes, `preview` maturity gating), so an AgentNet surface fits
without shell changes. Two shapes: embed the real webview SPA via the app
viewer iframe (blocked on zo publishing the sdk and a runnable localhost bin),
or a native read-tier panel backed by the plugin's tested indexer code, which
ships today with zero zo dependency.

**03 AgentNet as coding subagent.** eliza's orchestrator drives coding
backends over ACP, newline JSON-RPC on stdio, and every seam the binary needs
(runtime, engines, approval channel, headless wallet, session capture) already
exists in `packages/core`. One new `acp-stdio.ts` entry mirrors the existing
MCP entry; a demo needs zero upstream changes via the backend command
override, and every eliza coding run then lands as an encrypted session in a
wallet.

**04 Character inscription.** The vault soul stays the private master; this
adds a deliberate, spend-gated public snapshot: an allowlist-sanitized Eliza
character JSON inscribed via code-in under the wallet's signature, discovered
through a pointer self-note, adoptable by any foreign Eliza through two public
gateway routes the plugin already wraps. Every rail exists in core; the open
question is doctrine (public identity as a product), which is why it is a
sketch and proposed last.

**05 Steward-governed wallets.** The write tier currently holds a raw keypair
in the LLM's process; Steward ships a Solana signing route that decodes policy
fields from the transaction bytes, enforces spending limits and allowlists,
and audits every signature. Core's `Wallet` interface was built for foreign
signers, so the bridge is one `stewardWallet` implementation plus an
`AGENTNET_SIGNER` switch. Two honest frictions are documented: the encryption
key needs a one-time attended enrollment, and Steward needs an IQ program
decoder entry before policy is fully honest for AgentNet transactions.

## Suggested order of proposal

1. **03 subagent**: smallest ask with the strongest strategic hook. The demo
   runs with zero changes to her repos, and the payoff lands directly on her
   north star: real coding sessions captured to wallets from someone else's
   deployment.
2. **01 cloud auth**: removes the vendor-subscription onboarding wall, which
   is her stated stage-1 pain. Probe-first plan means the proposal arrives
   with evidence, not speculation.
3. **02 view**: Shape B ships alone inside the plugin and is a visible win;
   raising it also motivates the sdk publish that unblocks Shape A, which she
   has to want anyway for any external host.
4. **05 steward**: the safety upgrade the write tier genuinely needs, but it
   spans three repos and two review lanes; bring the devnet demo from its
   Shortest path as the opener.
5. **04 inscription**: pure product doctrine (public identity vs private
   soul). Propose once the plugin relationship is established and the cheaper
   ideas have built trust; it is a one-tool increment whenever she says yes.

## House rules these docs follow

Terse, mechanism first, mermaid where a flow needs it, no em or en dashes
anywhere, real file paths only (every citation was read, not guessed), honest
maturity labels, and a Shortest path section closing each doc with the
minimal correct increment that ships first.
