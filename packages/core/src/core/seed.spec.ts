import { describe, it, expect } from "vitest";
import {
  AGENTNET_ROOT_ID,
  mysessionsHint,
  reviewsHint,
  reviewsAgentHint,
  networkFromRpcUrl,
  getGatewayUrl,
  ENDPOINTS,
} from "./seed.js";

describe("core/seed", () => {
  it("should have correct static constants", () => {
    expect(AGENTNET_ROOT_ID).toBe("agentnet-root");
  });

  it("should format mysessionsHint correctly", () => {
    expect(mysessionsHint("11111111111111111111111111111111")).toBe(
      "mysessions:11111111111111111111111111111111"
    );
  });

  it("should format reviewsHint correctly (collection then item)", () => {
    expect(reviewsHint("SkillsCollection", "SkillMint123")).toBe(
      "reviews:SkillsCollection:SkillMint123"
    );
  });

  it("should format reviewsAgentHint correctly", () => {
    expect(reviewsAgentHint("AgentWallet123")).toBe("reviews:agent:AgentWallet123");
  });

  describe("networkFromRpcUrl — gateway follows the live RPC, not the static switch", () => {
    it("reads devnet from common devnet RPC hosts", () => {
      expect(networkFromRpcUrl("https://api.devnet.solana.com")).toBe("devnet");
      expect(networkFromRpcUrl("https://devnet.helius-rpc.com/?api-key=x")).toBe("devnet");
    });

    it("reads mainnet from common mainnet RPC hosts", () => {
      expect(networkFromRpcUrl("https://api.mainnet-beta.solana.com")).toBe("mainnet");
      expect(networkFromRpcUrl("https://mainnet.helius-rpc.com/?api-key=x")).toBe("mainnet");
    });

    it("matches the gateway to the RPC's network", () => {
      // a mainnet RPC must map to the mainnet gateway even though the static NETWORK is devnet
      expect(getGatewayUrl(networkFromRpcUrl("https://api.mainnet-beta.solana.com"))).toBe(
        ENDPOINTS.mainnet.gateway
      );
      expect(getGatewayUrl(networkFromRpcUrl("https://api.devnet.solana.com"))).toBe(
        ENDPOINTS.devnet.gateway
      );
    });

    it("falls back to the static network for an unrecognized host", () => {
      // no network token in the host -> static switch (devnet in this build)
      expect(networkFromRpcUrl("https://my-private-node.example.com/rpc")).toBe("devnet");
    });
  });
});
