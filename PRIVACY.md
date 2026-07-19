# AgentNet Privacy Policy

Effective date: July 19, 2026

This privacy policy describes how the AgentNet app ("AgentNet", "the app") handles user
and device data. AgentNet is developed by the IQLabs team ("we").

Contact: dwckey5356@gmail.com or https://github.com/IQCoreTeam/AgentNet/issues

## Summary

AgentNet is a local-first application. The agent, its chat sessions, and your keys live on
your own device. We do not run analytics, we do not show ads, we do not sell data, and we
do not operate servers that store your personal data. Data leaves your device only in the
ways listed below, each of which you initiate and control.

## Data the app handles

### 1. Chat content and sessions

Your conversations with the agent are stored on your device, encrypted with a key derived
from your wallet. To generate responses, the content of a conversation is sent to the AI
provider you connect with your own account (Anthropic Claude or OpenAI Codex). That
transfer happens under the provider's own terms and privacy policy; we do not receive or
store it.

If you enable the optional cloud backup, encrypted session files are uploaded to your own
Google Drive using the limited `drive.file` scope (the app can only see files it created).
Files are encrypted on your device before upload; only your wallet key can decrypt them.
We have no access to your Drive or its contents.

### 2. Wallet and keys

You can connect an external Solana wallet (via Mobile Wallet Adapter) or create a local
wallet. A local wallet's private key is generated on your device and never leaves it.
For external wallets, signing happens inside your wallet app; AgentNet only receives your
public address and the signatures you approve. We never receive or store private keys.

### 3. On-chain activity

Actions you take on the Solana blockchain through the app (connecting a wallet address,
buying or publishing skills, posting comments) are public and permanent by the nature of
public blockchains. Anyone can see them. Do not put private information in on-chain
content such as skill text or comments.

### 4. Credentials you optionally provide

The app can store, on your device only, credentials you choose to add: a Google account
authorization for Drive backup, a Helius RPC API key, and a GitHub token for registering
verified work. Each is used solely to call that service on your behalf and can be removed
in Settings at any time.

### 5. Device permissions

- Microphone: used only for voice input when you tap the microphone button. Audio is used
  to produce the text of your message and is not otherwise recorded or shared.
- Notifications: used to tell you when the agent finishes or needs approval.
- Foreground service / wake lock: keeps the on-device agent running while a task is
  active. No data is involved.

The app does not request location, contacts, camera, or SMS access.

## Third-party services

Depending on the features you use, your device communicates directly with: the Solana RPC
endpoint (the public endpoint or your own Helius key), the IQLabs gateway and indexer
(public on-chain data reads), Google Drive (your backup), GitHub (verified-work
registration), and the AI provider you signed into (chat content). Each service receives
only what is needed for that function, and each operates under its own privacy policy.

## Data retention and deletion

Local data (sessions, keys, tokens) stays on your device until you disconnect your wallet,
remove the credential, or uninstall the app. Drive backups are files in your own Google
Drive that you can delete at any time. On-chain data cannot be deleted; it is a permanent
public record.

## Children

AgentNet is not directed at children under 13, and we do not knowingly handle data from
children.

## Changes

We will update this document if the app's data practices change, and note the new
effective date above.
