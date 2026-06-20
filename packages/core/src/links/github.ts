export type GithubLinkKind = "repo" | "pull" | "commit" | "blob";

export interface GithubLinkInfo {
  kind: GithubLinkKind;
  href: string;
  owner: string;
  repo: string;
  label: string;
  meta: string;
  number?: string;
  sha?: string;
  path?: string;
}

const SAFE_EXTERNAL_PROTOCOLS = new Set(["https:", "http:", "git:"]);

export function safeExternalUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!SAFE_EXTERNAL_PROTOCOLS.has(url.protocol)) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function parseGithubLink(raw: string | undefined): GithubLinkInfo | null {
  const href = safeExternalUrl(raw);
  if (!href) return null;

  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();
  if (host !== "github.com" && host !== "www.github.com") return null;

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return null;

  const [owner, repo, section, value, ...rest] = parts;
  const repoName = repo.replace(/\.git$/i, "");
  const repoFullName = `${owner}/${repoName}`;

  if (!section) {
    return {
      kind: "repo",
      href,
      owner,
      repo: repoName,
      label: repoFullName,
      meta: "GitHub repository",
    };
  }

  if (section === "pull" && value && /^\d+$/.test(value)) {
    return {
      kind: "pull",
      href,
      owner,
      repo: repoName,
      number: value,
      label: `${repoFullName} #${value}`,
      meta: "GitHub pull request",
    };
  }

  if (section === "commit" && value && /^[0-9a-f]{7,40}$/i.test(value)) {
    return {
      kind: "commit",
      href,
      owner,
      repo: repoName,
      sha: value,
      label: `${repoFullName}@${value.slice(0, 7)}`,
      meta: "GitHub commit",
    };
  }

  if (section === "blob" && value && rest.length > 0) {
    const path = rest.join("/");
    return {
      kind: "blob",
      href,
      owner,
      repo: repoName,
      path,
      label: path,
      meta: repoFullName,
    };
  }

  return null;
}

export function isHttpsGithubUrl(raw: string | undefined): boolean {
  if (!raw) return false;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && (host === "github.com" || host === "www.github.com");
  } catch {
    return false;
  }
}
