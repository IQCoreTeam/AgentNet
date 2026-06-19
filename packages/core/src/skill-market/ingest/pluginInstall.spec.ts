import { describe, expect, it } from "vitest";
import type { SkillCard } from "../../chat/marketMessages.js";
import { installPluginFromCard } from "./pluginInstall.js";

describe("plugin NFT install guards", () => {
  const base: SkillCard = {
    id: "pluginMint",
    type: "plugin",
    name: "iq-git-reviewer",
    engines: ["claude", "codex"],
  };

  it("rejects plugin NFTs without install metadata", async () => {
    await expect(installPluginFromCard(base, "codex")).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("pluginManifest"),
    });
  });

  it("rejects engines not declared by the NFT", async () => {
    await expect(installPluginFromCard({ ...base, engines: ["claude"], pluginManifest: { id: "iq-git-reviewer" } }, "codex"))
      .resolves.toMatchObject({
        ok: false,
        error: expect.stringContaining("does not declare codex support"),
      });
  });
});
