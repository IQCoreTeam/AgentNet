# Open-source announcement thread (X) - on-chain skill NFT collection + contract

Draft thread for opening `agentnet-nft-contract` + `agentnet-nft-indexer`. Each tweet is under
the 280-char limit. One mermaid per content tweet (render to an image to attach; Twitter does not
render mermaid). Tweets 2 and 3 mirror the contract README diagrams; 1 and 4 are new here.

---

## 1/ (intro)

> Today I open-source the NFT collection behind AgentNet's on-chain skills, and the contract that runs it.
>
> An on-chain semi-fungible collection anyone can put a file into. I hope it becomes a good standard, and that marketplaces like Magic Eden or Tensor render NFTs like these.

Mermaid - the big picture (a file becomes a member of an open on-chain collection):

```mermaid
flowchart LR
    A[SKILL.md file] -->|code-in inscription| B[content on-chain]
    B --> C[Token-2022 soulbound mint]
    C -->|enroll| D[(Official skill / workflow collection)]
    D --> E[anyone reads the registry straight from the chain]
```

## 2/ (what it is)

> TL;DR: it is an on-chain collection of SKILL.md files.
>
> A creator applies to my contract, and it enrolls their mint as a member of the official skill or workflow collection. That membership is the registry, read straight from the chain.

Mermaid - register into the collection (mirrors the contract README "How a mint is registered"):

```mermaid
sequenceDiagram
    actor Creator
    participant Gate as agentnet-nft-contract
    participant T22 as Token-2022
    Creator->>Gate: publish_item (apply to register)
    Gate->>T22: enroll the mint into the official collection (PDA-signed)
    Gate->>T22: mint 1 copy to the creator
    Gate->>T22: freeze the item (update authority -> program PDA)
    Note over Gate,T22: now a collection member, and immutable
```

## 3/ (minting + economics)

> Every copy is minted by an on-chain buy. Buying a skill mints one more. On each mint 6.9% goes to the protocol and all the rest goes straight to the creator. No layer in between taking a cut.

Mermaid - buy mints a copy and splits the price (mirrors the README buy flow):

```mermaid
flowchart TD
    A[buy_item, mint one more copy] --> B{price > 0?}
    B -- yes --> C[6.9% to protocol]
    B -- yes --> D[the rest to the creator]
    B -- no --> E[free mint]
    C --> F[1 soulbound copy to the buyer]
    D --> F
    E --> F
```

## 4/ (the idea)

> No resale, no trading. You publish knowledge in the open; anyone who wants it tips the creator and gets an agent skill that lives under their wallet, with no server keeping it alive. That is the whole thing.

Mermaid - a skill's life: publish once, tip to collect, lives under the wallet forever:

```mermaid
flowchart LR
    P[Creator publishes knowledge] --> I[immutable on-chain skill]
    U[User tips the creator] --> M[buy = mint 1 copy]
    I --> M
    M --> W[skill lives under the user's wallet]
    W -. no server, no resale .-> W
```

## 5/ (links)

> Open source. Fork it, index it, build on it.
>
> Contract (the item gate): https://github.com/IQCoreTeam/agentnet-nft-contract
> Indexer: https://github.com/IQCoreTeam/agentnet-nft-indexer
