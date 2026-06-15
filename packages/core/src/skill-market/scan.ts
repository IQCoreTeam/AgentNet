// First-pass danger scan for a candidate skill's text (plans/skill-shopping.md §3 ①).
//
// This is the CODE half of verify — the cheap, deterministic gate that runs BEFORE the
// model judges. It only catches the OBVIOUS, unambiguous danger (so a hit means "don't
// even bother the model, reject now"); the nuanced "would this harm the user?" call is
// the agent's, made over the body via the verify-skill rubric. Keep the patterns
// CONSERVATIVE: a false positive here silently buries a fine skill, so we flag only
// things that are almost never legitimate in a skill document.
//
// We also decode base64/hex blobs and re-scan the decoded text, since the common way to
// slip a destructive command past a reader is to obfuscate it (OWASP input-validation).

export interface ScanResult {
  safe: boolean; // false = an obvious-danger pattern matched (reject without the model)
  hits: string[]; // which patterns matched (for the rejection reason / logging)
}

// Patterns that are almost never legitimate inside a skill's instructions. Each entry is
// [label, regex]; the label is what we surface as the reason.
const DANGER: [string, RegExp][] = [
  ["destructive filesystem wipe", /\brm\s+-[a-z]*\s*(-[a-z]+\s+)*(\/|~|\$HOME|\*)/i],
  ["disk overwrite (dd to a device)", /\bdd\s+if=.*\bof=\/dev\//i],
  ["filesystem format", /\bmkfs(\.\w+)?\s+\/dev\//i],
  ["fork bomb", /:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;/],
  ["curl/wget piped straight into a shell", /\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(bash|sh|zsh)\b/i],
  ["reads a wallet keypair / seed phrase", /(id\.json|keypair\.json|\.config\/solana|wallet\.json|mnemonic|seed[\s_-]?phrase|secret[\s_-]?key)/i],
  ["exfiltrates env / secrets to the network", /\b(curl|wget|fetch|nc|netcat)\b[^\n]*\b(env|process\.env|API_KEY|TOKEN|SECRET|PRIVATE_KEY)\b/i],
  ["deletes credentials / ssh keys", /\brm\b[^\n]*(\.ssh|\.aws|\.config\/solana|credentials)/i],
];

// Pull out base64-ish and long-hex runs so we can decode + re-scan obfuscated payloads.
// Conservative: only blobs long enough to hide a command (>= 24 chars) are worth decoding.
const BASE64_RUN = /[A-Za-z0-9+/]{24,}={0,2}/g;
const HEX_RUN = /(?:[0-9a-fA-F]{2}){16,}/g;

function decodeBlobs(text: string): string[] {
  const out: string[] = [];
  for (const m of text.match(BASE64_RUN) ?? []) {
    try {
      const d = Buffer.from(m, "base64").toString("utf8");
      // Keep only mostly-printable decodes (random data base64-decodes to garbage).
      if (d && /[\x20-\x7e]/.test(d) && printableRatio(d) > 0.85) out.push(d);
    } catch { /* not valid base64 — ignore */ }
  }
  for (const m of text.match(HEX_RUN) ?? []) {
    try {
      const d = Buffer.from(m, "hex").toString("utf8");
      if (d && printableRatio(d) > 0.85) out.push(d);
    } catch { /* not valid hex — ignore */ }
  }
  return out;
}

function printableRatio(s: string): number {
  let p = 0;
  for (const c of s) if (c >= " " && c <= "~") p++;
  return s.length ? p / s.length : 0;
}

function matchDanger(text: string): string[] {
  return DANGER.filter(([, re]) => re.test(text)).map(([label]) => label);
}

/**
 * Scan a skill body for obvious danger, including obfuscated (base64/hex) payloads.
 * `safe: false` means reject now without consulting the model; `safe: true` means it
 * cleared the mechanical gate — the model still has to judge the nuanced case.
 */
export function scanSkillText(text: string): ScanResult {
  const hits = new Set(matchDanger(text));
  for (const decoded of decodeBlobs(text)) {
    for (const h of matchDanger(decoded)) hits.add(`${h} (obfuscated)`);
  }
  return { safe: hits.size === 0, hits: [...hits] };
}