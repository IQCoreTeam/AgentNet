# AgentNet Surface Summary & Feature Parity Report

This document provides a comprehensive, deep-dive assessment of the AgentNet monorepo surfaces, connection protocols, and active development branches. It details how the surfaces interact, how session synchronization operates, and maps out the exact state of implementation across the codebase.

---

## 1. Overview of Surfaces & Repository Layout

AgentNet defines five distinct user interface surfaces designed to interact with the common core SDK (`packages/core`):

1. **CLI (`surfaces/cli`)**: An interactive Ink-based TUI designed for standard terminals. Operates with local keypairs.
2. **VS Code Extension (`surfaces/vscode`)**: A extension host wrapper that mounts a custom editor Webview panel.
3. **Localhost Server (`surfaces/localhost`)**: A local Node.js process serving the Webview SPA. It handles local HTTP-RPC and Server-Sent Events (SSE) connections.
4. **Webview (`surfaces/webview`)**: A browser-compatible React SPA built using Vite, TailwindCSS, and `@solana/web3.js`.
5. **Android Shell (`surfaces/android`)**: A native Kotlin application hosting the local Node server and a Webview to provide a standalone mobile client.

---

## 2. Connection Protocols & Bridging Details

The communication mechanics vary per surface to allow running identical runtimes over separate IPC/network channels.

### A. Webview ⇄ Localhost Server (HTTP-RPC & SSE)
This protocol provides a steady connection inside browsers and mobile WebViews without WebSocket upgrade issues.
- **Outbox (UI → Server):** Commands are sent as JSON payloads to `POST /rpc?client=<client_id>`. Interactive actions (ready, start sessions, delete, approve tools) are pushed asynchronously.
- **Inbox (Server → UI):** Broadcasts, state changes, delta token streams, and tool approval requests flow through a persistent Server-Sent Events (SSE) stream on `GET /events?client=<client_id>`.
- **Client ID Handshake:** On first connect to `/events`, the server emits a unique `client` event containing the client ID. The client caches this ID and appends it to all future POST queries to ensure the server routes commands to the correct session's `onRecv` listeners.
- **Resiliency & Event Replay:** To survive brief WebView or network drops, the client tracks the last received message index (`seq`). On reconnect, it calls `/events?client=<client_id>&cursor=<seq>`. The server retrieves missed messages from its `REPLAY_BUFFER` (cap: 256 events) and streams them instantly.
- **Graceful Teardown:** When the SSE stream disconnects, the server sets a `RECONNECT_GRACE_MS` (15 seconds) timer before executing the session teardown callback. If the client reconnects within this window, the session resumes seamlessly.

### B. Webview ⇄ VS Code Extension (postMessage API)
Inside VS Code, the extension acts as the host instead of the localhost Node process.
- **Data Exchange:** The extension uses `panel.webview.html = chatHtml()` to load the interface. It utilizes VS Code's native `postMessage` (extension → webview) and `onDidReceiveMessage` (webview → extension) channels.
- **Integration:** The extension wraps these calls into a lightweight transport object and passes it to `createChatSession`. Approvals flow through a `TransportApprovalChannel`.

### C. Android Shell ⇄ WebView ⇄ Wallet (Kotlin MWA Bridge)
Because mobile WebViews do not have injected browser wallet extensions (e.g. Phantom, Solflare), Android requires a custom native-to-JS bridge.
- **Javascript Interface:** The Kotlin side injects `window.AgentNetWallet` via `addJavascriptInterface` inside [MainActivity.kt](file:///Users/parthagrawal99/Desktop/iq-labs/AgentNet/surfaces/android/app/src/main/java/com/iqlabs/agentnet/MainActivity.kt).
- **Asynchronous Execution:** The JS side ([androidWallet.ts](file:///Users/parthagrawal99/Desktop/iq-labs/AgentNet/surfaces/webview/src/onboarding/androidWallet.ts)) wraps requests in a Promise, invoking `AgentNetWallet.connect(requestJson)` with a callback ID. The Kotlin bridge launches a coroutine to run the Mobile Wallet Adapter (MWA) `transact` loop.
- **MWA Transact Loop:** The wallet adapter prompts the user to select an installed wallet app, requests authorization, and signs the session key derivation message using `signMessagesDetached`.
- **Callback Delivery:** Once complete, Kotlin serializes the results (pubkey bytes, signature bytes) and invokes `window.__onWalletResult(resultJson)` on the UI thread to resolve the JS Promise.

---

## 3. Off-Chain Session Sync & Storage Loop

AgentNet implements a hybrid state-management system to keep sessions private, free of transaction fees, and cross-device compatible.

```
[UI / Runtime Session Update]
              │
              ▼ (dhEncrypt with derived X25519 key)
      [Encrypted JSON Blob]
              │
              ├──────────────────────────────────────────┐
              ▼ (adapter.put)                            ▼ (writeRow)
   [User Cloud Storage]                         [Solana Blockchain]
(GDrive / iCloud / S3 / Custom)                 (IQLabs `mysessions` table)
  └── Path: `agentnet/sessions/{id}`               └── Content: sessionId, owner wallet address
                                                   └── Writers: Restricted to owner wallet only
```

### A. Key Derivation & Encryption
- The user's Solana wallet signs a fixed message: `SESSION_KEY_MESSAGE = "iq-sdk-derive-encryption-key-v1"`.
- This signature is passed to the SDK's `deriveX25519Keypair` to produce an X25519 keypair.
- Session payloads are encrypted/decrypted using authenticated AES-GCM encryption (`dhEncrypt`/`dhDecrypt`).
- **Sync Advantage:** Because the derivation message is fixed, the same Solana wallet produces the identical X25519 key on any computer or mobile phone. No private keys are ever shared, uploaded, or moved.

### B. User-Owned Storage Adapters
Encrypted files are saved to storage owned and controlled by the user. 
- The storage configuration lives solely in the local `config.json` file on the device, maintaining user privacy.
- Files are saved to a deterministic path: `{storage}/agentnet/sessions/{sessionId}`.
- Storage options include:
  - **Local:** Session files saved locally (always enabled as primary storage).
  - **GDrive:** Google Drive OAuth client-side integration (tokens stored locally in `tokens/google.json`).
  - **iCloud:** Local Apple iCloud directories.
  - **Custom:** HTTP / S3 / WebDAV user-hosted endpoints.

### C. On-Chain `mysessions` Index
To restore sessions across devices, the application checks the blockchain for session metadata.
- Under the `agentnet-root` DbRoot namespace, the app queries the `mysessions` table.
- Each row contains:
  ```json
  { "sessionId": "uuid", "wallet": "<base58-address>", "title": "Session Title", "ts": 1700000000 }
  ```
- **Permissioning:** The table's writers list is set to the owner's wallet address (`writers = [owner]`). This ensures that only the wallet owner can add rows to their index.
- **Fee Optimization:** Because AES-GCM encryption natively guarantees data integrity, there is no need to write session data hashes on-chain. An on-chain `writeRow` is sent **only once** when a session is initialized. Subsequent chat updates only write to the cloud storage adapter—saving users transaction fees and network delays.

---

## 4. Feature Parity Matrix

| Feature | CLI (`surfaces/cli`) | VS Code Extension | Localhost Server | Webview | Android Shell |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Status** | Unmerged (`feat/agentnet-cli`) | Merged to `main` | Merged to `main` | Merged to `main` | Merged to `main` |
| **Engine Selection** | Yes (Claude & Codex) | Yes (Claude & Codex) | Yes (Claude & Codex) | Yes (Claude & Codex) | Yes (Claude & Codex) |
| **Auth Flows** | Claude (CLI prompt) / Codex (Device OAuth or API Key) | Claude (WebView) / Codex (Device OAuth or API Key) | Handles OAuth/Device Auth redirection | Connects to host via proxy messages | Connects via local server proxy |
| **Session Persistence** | Local files + Cloud mirror config | Local files + Cloud mirror config | Managed by host adapter | Displays list / sends RPC messages | Local server files + Cloud mirror |
| **Wallet signing type** | **Keypair Wallet** (file-based) | **Keypair Wallet** (file-based) | **Web Wallet** (replayed signature) | Browser injected (Phantom, etc.) | **Mobile Wallet Adapter (MWA)** |
| **On-Chain Transactions** | **Real** (Full Keypair signing) | **Real** (Full Keypair signing) | **Mocked / Unsupported** (Throws) | Depends on host | **Mocked / Unsupported** (Throws) |
| **RPC Configuration** | Missing (No Helius UI) | Missing on `main` (In `rpc-onboarding`) | Passive routing | Displays status | Passive routing |
| **Interactive Tool Diffs** | Yes (Green/Red inline shading) | No (Basic JSON parameters) | Serves text diffs | Renders simple diff text | Renders simple diff text |
| **Danger Heuristics** | Yes (Regex checking + warning) | No | No | No | No |

---

## 5. Wallet & Transaction Signing (Real vs. Mocked)

### A. Real On-Chain Signing (CLI & VS Code)
The CLI and VS Code extension load keypairs directly from a file path (defaulting to the Solana standard `~/.config/solana/id.json`). They instantiate the wallet using [keypairWallet.ts](file:///Users/parthagrawal99/Desktop/iq-labs/AgentNet/packages/core/src/account/keypairWallet.ts).
- Because they hold the keypair in memory, their `signTransaction` and `signAllTransactions` methods call the Solana Web3 library directly:
  ```typescript
  async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
    if ("version" in tx) (tx as VersionedTransaction).sign([kp]);
    else (tx as Transaction).partialSign(kp);
    return tx;
  }
  ```
- **Result:** CLI and VS Code are fully capable of executing on-chain actions like purchasing or publishing skills and workflows.

### B. Mocked On-Chain Signing (Localhost & Android)
The Localhost server (and the web/mobile clients connecting to it) only receives the initial address and the session signature during onboarding. The server does not hold the private key, so it instantiates the wallet using [webWallet.ts](file:///Users/parthagrawal99/Desktop/iq-labs/AgentNet/packages/core/src/account/webWallet.ts).
- Since it cannot generate on-chain signatures, its transaction methods are mocked:
  ```typescript
  async signTransaction<T extends Transaction | VersionedTransaction>(_tx: T): Promise<T> {
    throw new Error("on-chain signing not wired through the web wallet yet (Track 2).");
  }
  ```
- **Result:** Running AgentNet in a browser or inside the Android shell will throw a runtime error if the agent attempts to call `buy_skill`.

---

## 6. CLI Advanced Features ("Claude Code" Capabilities)

The unmerged CLI branch (`feat/agentnet-cli`) implements advanced UX capabilities that the VS Code extension and Webviews currently lack. These TUI capabilities bring it closer to the functionality of "Claude Code":

1. **Interactive TUI Diff Viewer:** Calculates inline Longest Common Subsequence diffs (green background for additions, red for deletions) inside tool cards (`Edit`, `MultiEdit`, `Write`) to let users inspect file changes before approving them.
2. **Shell Danger Flag Heuristics:** Scans shell commands using regular expressions in [spawn.ts](file:///Users/parthagrawal99/Desktop/iq-labs/AgentNet/packages/core/src/runtime/spawn.ts) to intercept dangerous actions:
   - Destructive files removals (`rm -rf`, `rm -f`).
   - Root privilege executions (`sudo`).
   - Destructive Git operations (`git push --force`, `git reset --hard`, `git clean -fd`).
   - Root modifications (`chmod -R`, `chown -R`, `mkfs`, `dd`).
   - Pipe-to-shell downloads (`curl | sh`, `wget | bash`).
   - Registry publications (`npm publish`).
3. **Esc Interrupt Handler:** Captures the `ESC` key to instantly interrupt and abort active agent tool execution and output streams.
4. **Usage Context Tracking:** Real-time token usage reporting (`onUsage` handler) updated dynamically in the TUI composer status lines.
5. **Anti-Laziness Nudges:** Appends a strict reminder to the system prompt forcing the model to verify operations using tools (like reading files or bash) rather than assuming a task is completed.

---

## 7. Active Branches & Alignment Plan

Based on the chat logs between **Zo** and **shankstwin**, the project is currently in a fragmented state where the CLI and VS Code environments have diverged. 

### Branch Statuses
- **`feat/agentnet-cli` (Unmerged):** Contains the Ink TUI, the custom JSON-RPC Codex wrapper, and the diff/danger heuristics.
- **`feat/passive-skill-shopping` (Unmerged):** Integrates the marketplace MCP tools, allows passive skill verification, and includes Sol balance checks.
- **`origin/feat/rpc-onboarding` (Unmerged):** Configures Helius API keys to solve Solana public RPC rate-limiting, which currently prevents DAS searches from loading the marketplace.
- **`main`:** Contains the VS Code panel view, the shared marketplace message contracts, and Google Drive memory sync, but lacks CLI additions and the Helius RPC configuration inputs.

### Developer Collaboration Goals & Next Steps
- **shankstwin's Task:** Align and verify the CLI branch features, and create this unified doc to track surface parity.
- **Zo's Task:** Integrate the common AgentNet runtime improvements directly into the VS Code extension surface.
- **Testing Cross-Device Session Sync:** The team needs to verify if logging into the same account (Solana wallet + Google Drive) on different PCs successfully syncs the chat history. Currently, this can fail if:
  1. The user has not registered a Helius key (blocking DAS queries that fetch owned skills).
  2. The Google Drive OAuth flow is not initialized properly.
  3. The localhost server stubs are not resolving storage configuration events.
- **Stability and Deployment:** The plan is to merge the CLI improvements and Helius RPC configurations into `main`, resolve the mocked transaction signing in Web/Android, stabilize the environments for a week, and then deploy and begin marketing.
