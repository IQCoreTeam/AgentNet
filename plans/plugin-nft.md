# Plugin NFT

> Sibling collections: [`skill-nft-structure.md`](skill-nft-structure.md) and
> [`workflow-nft.md`](workflow-nft.md). A plugin is an installable capability bundle
> for one or more agent engines, anchored to IQ Git provenance.

---

## 0. What a plugin is

A **skill** is an ability the agent reads and follows. A **workflow** is a gated
recipe that proves an agent owns the required skills. A **plugin** is an
installable package: skills, MCP servers, hooks, apps, manifests, or other runtime
capabilities bundled behind a versioned plugin manifest.

Plugin NFTs are not Claude-only. Claude, Codex, MCP, and future runtimes are
represented as engine badges in metadata.

## 1. Same Token-2022 pattern, separate collection

Plugins use the same NFT foundation as skills/workflows:

| | Plugin collection |
|---|---|
| token | one Token-2022 mint per plugin package/version |
| soulbound | `NonTransferable` |
| popularity | `mint.supply` |
| content (`uri`) | code-in plugin NFT JSON |
| provenance | IQ Git PDA in JSON + `iqGitPda` trait |
| engine badges | repeated `engine` traits, e.g. `claude`, `codex`, `mcp` |

The plugin collection is its own umbrella collection. It must not be mixed into
skills or workflows because plugin search, install, and trust checks have
different semantics.

## 2. Plugin JSON shape

The code-in `uri` points at a standard NFT JSON object with AgentNet plugin
extensions:

```jsonc
{
  "name": "iq-git-reviewer",
  "image": "<txid | url | omitted>",
  "description": "Review code with IQ Git context.",
  "attributes": [
    { "trait_type": "category", "value": "developer-tools" },
    { "trait_type": "plugin", "value": "git" },
    { "trait_type": "plugin", "value": "review" },
    { "trait_type": "engine", "value": "claude" },
    { "trait_type": "engine", "value": "codex" },
    { "trait_type": "iqGitPda", "value": "IqGitPda111..." }
  ],
  "version": "1.2.3",
  "iqGitPda": "IqGitPda111...",
  "engines": ["claude", "codex"],
  "capabilities": ["git.read", "review.write"],
  "permissions": ["fs.read"],
  "pluginManifest": {
    "id": "iq-git-reviewer",
    "entrypoint": ".codex-plugin/plugin.json"
  }
}
```

Rules:

- `engine` is repeated once per supported runtime. This is what surfaces render
  as Claude/Codex/MCP badges.
- `iqGitPda` is the canonical provenance anchor. URLs may be display helpers, but
  they are not the identity.
- `plugin` traits are tag-like labels, parallel to `skill` hashtag traits.
- `pluginManifest` is descriptive in this v1 slice. Installers must still
  validate the manifest and permissions before materializing anything locally.

## 3. Buy/equip model

The intended v1 UX is **buy equals equip**, matching skills. Buying proves the
wallet owns the plugin package, and the local runtime may then install/equip it
after manifest and permission validation.

This document does not implement minting, publishing, or local install. It only
settles the collection and metadata shape those flows will use.

## 4. Reviews

Plugin comments reuse the existing review table shape:

```
reviews:{pluginsCollectionMint}:{pluginMint}
```

No plugin-specific review table is added.

## 5. Build order

1. Add plugin collection/type plumbing and metadata parsing.
2. Add plugin browse/detail UI with engine badges and IQ Git PDA display.
3. Add plugin publish from IQ Git PDA + plugin manifest.
4. Add buy/equip that validates manifest, permissions, and engine compatibility.
5. Show owned/equipped plugins on agent profiles beside skills and workflows.
