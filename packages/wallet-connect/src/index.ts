import SignClient from "@walletconnect/sign-client";
import type { WalletTransport } from "@iqlabs-official/agent-sdk";
import bs58 from "bs58";
import qrcode from "qrcode";

export function wcTransport(opts: {
  projectId: string;
  chain?: string;
}): WalletTransport {
  const chainId = opts.chain === "solana:mainnet" || !opts.chain
    ? "solana:5ey2ja1KstPwMQRx7EokG2dfJksAGGPA"
    : opts.chain;

  let client: SignClient | null = null;
  let session: any = null;

  async function getClient() {
    if (client) return client;
    client = await SignClient.init({
      projectId: opts.projectId,
      metadata: {
        name: "AgentNet",
        description: "AgentNet Wallet Connection",
        url: "https://agentnet.dev",
        icons: ["https://agentnet.dev/icon.png"],
      },
    });
    return client;
  }

  return {
    async connect() {
      const c = await getClient();
      
      const { uri, approval } = await c.connect({
        requiredNamespaces: {
          solana: {
            chains: [chainId],
            methods: ["solana_signMessage", "solana_signTransaction"],
            events: [],
          },
        },
      });

      const approvedPromise = (async () => {
        const sess = await approval();
        session = sess;
        const accounts = sess.namespaces.solana.accounts;
        const address = accounts[0].split(":")[2];
        return { address };
      })();

      return {
        uri: uri || "",
        approved: approvedPromise,
      };
    },

    async signMessage(msg: Uint8Array): Promise<Uint8Array> {
      if (!session) throw new Error("No active session. Call connect() first.");
      const c = await getClient();
      const address = session.namespaces.solana.accounts[0].split(":")[2];
      
      const response = await c.request<string | { signature: string }>({
        topic: session.topic,
        chainId,
        request: {
          method: "solana_signMessage",
          params: {
            message: bs58.encode(Buffer.from(msg)),
            pubkey: address,
          },
        },
      });

      if (typeof response === "string") {
        return bs58.decode(response);
      } else if (response && typeof response === "object" && "signature" in response) {
        return bs58.decode(response.signature);
      }
      throw new Error("Invalid signMessage response from wallet");
    },

    async signTransaction<T>(tx: T): Promise<T> {
      if (!session) throw new Error("No active session. Call connect() first.");
      const c = await getClient();
      const address = session.namespaces.solana.accounts[0].split(":")[2];

      const serialized = (tx as any).serialize({ requireAllSignatures: false, verifySignatures: false });
      const txBase58 = bs58.encode(Buffer.from(serialized));

      const response = await c.request<string | { transaction: string } | { signature: string }>({
        topic: session.topic,
        chainId,
        request: {
          method: "solana_signTransaction",
          params: {
            transaction: txBase58,
            pubkey: address,
          },
        },
      });

      let signedBytes: Uint8Array;
      if (typeof response === "string") {
        const decoded = bs58.decode(response);
        if (decoded.length > 64) {
          signedBytes = decoded;
        } else {
          (tx as any).addSignature(new (await import("@solana/web3.js")).PublicKey(address), decoded);
          return tx;
        }
      } else if (response && typeof response === "object") {
        if ("transaction" in response && typeof response.transaction === "string") {
          signedBytes = bs58.decode(response.transaction);
        } else if ("signature" in response && typeof response.signature === "string") {
          const decoded = bs58.decode(response.signature);
          (tx as any).addSignature(new (await import("@solana/web3.js")).PublicKey(address), decoded);
          return tx;
        } else {
          throw new Error("Invalid signTransaction response format");
        }
      } else {
        throw new Error("Invalid signTransaction response format");
      }

      const isVersioned = "version" in (tx as any);
      if (isVersioned) {
        const { VersionedTransaction } = await import("@solana/web3.js");
        return VersionedTransaction.deserialize(signedBytes) as unknown as T;
      } else {
        const { Transaction } = await import("@solana/web3.js");
        return Transaction.from(signedBytes) as unknown as T;
      }
    },

    async disconnect() {
      if (session) {
        const c = await getClient();
        await c.disconnect({
          topic: session.topic,
          reason: { code: 6000, message: "User disconnected" },
        }).catch(() => {});
        session = null;
      }
    },
  };
}

export async function generateQrDataUri(uri: string): Promise<string> {
  return qrcode.toDataURL(uri);
}
