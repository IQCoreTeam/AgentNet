import { describe, it, expect } from "vitest";
import { parseSkillMd, sanitize, isValidSpdx, isValidUrl } from "./parse.js";

const VALID_SKILL = `---
name: my-skill
description: A skill that does something useful for agents
category: ai
hashtags: [reasoning, planning]
license: MIT
repository: https://github.com/example/my-skill
---

This skill teaches the agent how to reason step by step.
It covers planning, breaking down problems, and iterating on solutions.
`;

describe("validation/parse — parseSkillMd", () => {
  it("should parse valid frontmatter correctly", () => {
    const { frontmatter, body } = parseSkillMd(VALID_SKILL);
    expect(frontmatter.name).toBe("my-skill");
    expect(frontmatter.description).toBe(
      "A skill that does something useful for agents"
    );
    expect(frontmatter.category).toBe("ai");
    expect(frontmatter.license).toBe("MIT");
    expect(frontmatter.repository).toBe("https://github.com/example/my-skill");
    expect(Array.isArray(frontmatter.hashtags)).toBe(true);
    expect(body).toContain("This skill teaches");
  });

  it("should parse array fields from inline YAML list", () => {
    const md = `---\nhashtags: [one, two, three]\n---\nbody`;
    const { frontmatter } = parseSkillMd(md);
    expect(frontmatter.hashtags).toEqual(["one", "two", "three"]);
  });

  it("should return empty frontmatter when no opening --- is present", () => {
    const md = "Just a plain markdown file with no frontmatter.";
    const { frontmatter, body } = parseSkillMd(md);
    expect(frontmatter).toEqual({});
    expect(body).toBe(md);
  });

  it("should return empty frontmatter when closing --- is missing", () => {
    const md = "---\nname: broken\n";
    const { frontmatter, body } = parseSkillMd(md);
    expect(frontmatter).toEqual({});
    expect(body).toBe(md);
  });

  it("should handle empty body after frontmatter", () => {
    const md = "---\nname: no-body\ndescription: has a description that is long enough\n---\n";
    const { body } = parseSkillMd(md);
    expect(body).toBe("");
  });
});

describe("validation/parse — sanitize", () => {
  it("should strip ANSI escape sequences", () => {
    const evil = "\x1B[31mred text\x1B[0m normal";
    expect(sanitize(evil)).toBe("red text normal");
  });

  it("should leave normal text unchanged", () => {
    const safe = "Hello, world! 123";
    expect(sanitize(safe)).toBe(safe);
  });
});

describe("validation/parse — isValidSpdx", () => {
  it("accepts valid SPDX identifiers", () => {
    expect(isValidSpdx("MIT")).toBe(true);
    expect(isValidSpdx("Apache-2.0")).toBe(true);
    expect(isValidSpdx("GPL-3.0-only")).toBe(true);
  });

  it("rejects empty string", () => {
    expect(isValidSpdx("")).toBe(false);
  });

  it("rejects strings with internal spaces", () => {
    expect(isValidSpdx("MIT License")).toBe(false);
  });
});

describe("validation/parse — isValidUrl", () => {
  it("accepts https URLs", () => {
    expect(isValidUrl("https://github.com/foo/bar")).toBe(true);
  });

  it("accepts http URLs", () => {
    expect(isValidUrl("http://example.com")).toBe(true);
  });

  it("rejects non-URL strings", () => {
    expect(isValidUrl("not-a-url")).toBe(false);
    expect(isValidUrl("ftp://files.example.com")).toBe(false);
  });
});
