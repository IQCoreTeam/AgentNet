import { wcTransport } from "../packages/wallet-connect/src/index.js";
import { webWallet, SESSION_KEY_MESSAGE } from "../packages/core/src/account/webWallet.js";
import { deriveSessionKey } from "../packages/core/src/core/crypto.js";
import qrcode from "qrcode-terminal";

async function main() {
  const projectId = process.env.REOWN_PROJECT_ID;
  if (!projectId) {
    console.error("Please set REOWN_PROJECT_ID env var.");
    process.exit(1);
  }

  console.log("Initializing WalletConnect...");
  const transport = wcTransport({ projectId });

  console.log("Connecting...");
  const { uri, approved } = await transport.connect();

  console.log("Scan this QR code with Phantom or Solflare on your phone:\n");
  qrcode.generate(uri, { small: true });

  console.log("Waiting for approval...");
  const { address } = await approved;
  console.log(`Approved! Connected address: ${address}`);

  console.log(`Signing message: "${SESSION_KEY_MESSAGE}"...`);
  const msgBytes = new TextEncoder().encode(SESSION_KEY_MESSAGE);
  const signature = await transport.signMessage(msgBytes);
  console.log("Signature obtained:", Buffer.from(signature).toString("hex"));

  console.log("Validating with webWallet + deriveSessionKey...");
  const wallet = webWallet(address, signature);
  const sessionKey = await deriveSessionKey(wallet);
  console.log("Derived Session Key (PubHex):", sessionKey.pubHex);

  console.log("\nSuccess! POC verified.");
  await transport.disconnect();
}

main().catch(console.error);
