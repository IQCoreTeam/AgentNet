// Resolve an image reference for rendering. An http(s) link passes through as-is; an
// on-chain reference (a base58 code-in tx signature / address) is served through the IQ
// gateway's /data/{ref} route — the same resolver core uses (getGatewayUrl + readCodeIn).
// Anything else returns undefined so callers fall back to default art instead of a broken
// <img>. Mainnet gateway: production runs mainnet (dev uses dev-gateway.iqlabs.dev).
const GATEWAY = "https://gateway.iqlabs.dev";

export function mediaUrl(ref?: string | null): string | undefined {
  if (!ref) return undefined;
  const v = ref.trim();
  if (!v) return undefined;
  if (/^https?:\/\//i.test(v)) return v;
  if (/^[1-9A-HJ-NP-Za-km-z]{32,128}$/.test(v)) return `${GATEWAY}/data/${v}`;
  return undefined;
}
