import { describe, expect, it } from "vitest";
import { isHttpsGithubUrl, parseGithubLink, safeExternalUrl } from "./github.js";

describe("github link helpers", () => {
  it("keeps only safe external protocols", () => {
    expect(safeExternalUrl("https://example.com/x")).toBe("https://example.com/x");
    expect(safeExternalUrl("http://example.com/x")).toBe("http://example.com/x");
    expect(safeExternalUrl("git://github.com/owner/repo.git")).toBe("git://github.com/owner/repo.git");
    expect(safeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(safeExternalUrl("not a url")).toBeNull();
  });

  it("parses repository links", () => {
    expect(parseGithubLink("https://github.com/IQCoreTeam/AgentNet")).toMatchObject({
      kind: "repo",
      owner: "IQCoreTeam",
      repo: "AgentNet",
      label: "IQCoreTeam/AgentNet",
    });
  });

  it("parses pull request links", () => {
    expect(parseGithubLink("https://github.com/IQCoreTeam/AgentNet/pull/52")).toMatchObject({
      kind: "pull",
      number: "52",
      label: "IQCoreTeam/AgentNet #52",
    });
  });

  it("parses commit links", () => {
    expect(parseGithubLink("https://github.com/IQCoreTeam/AgentNet/commit/abcdef1234567890")).toMatchObject({
      kind: "commit",
      sha: "abcdef1234567890",
      label: "IQCoreTeam/AgentNet@abcdef1",
    });
  });

  it("parses blob links", () => {
    expect(parseGithubLink("https://github.com/IQCoreTeam/AgentNet/blob/main/packages/core/src/index.ts")).toMatchObject({
      kind: "blob",
      path: "packages/core/src/index.ts",
      label: "packages/core/src/index.ts",
      meta: "IQCoreTeam/AgentNet",
    });
  });

  it("ignores non-GitHub links for rich cards", () => {
    expect(parseGithubLink("https://example.com/IQCoreTeam/AgentNet")).toBeNull();
  });

  it("validates post_blog GitHub links as https only", () => {
    expect(isHttpsGithubUrl("https://github.com/IQCoreTeam/AgentNet")).toBe(true);
    expect(isHttpsGithubUrl("http://github.com/IQCoreTeam/AgentNet")).toBe(false);
    expect(isHttpsGithubUrl("git://github.com/IQCoreTeam/AgentNet.git")).toBe(false);
    expect(isHttpsGithubUrl("https://example.com/IQCoreTeam/AgentNet")).toBe(false);
  });
});
