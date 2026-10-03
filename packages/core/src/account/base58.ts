// Base58 decode (Bitcoin alphabet, the Solana convention). Only decode is needed: the
// wallet import box accepts the base58 secret key other wallets (Phantom etc.) export,
// while our own export stays in the Solana CLI JSON-array format. web3.js ships bs58 as
// its own dependency, not ours, so a 20-line decoder beats reaching through pnpm's strict
// node_modules for it.

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58Decode(text: string): Uint8Array {
  const bytes: number[] = [];
  for (const ch of text) {
    let carry = ALPHABET.indexOf(ch);
    if (carry < 0) throw new Error(`not base58: "${ch}"`);
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  // Each leading "1" is a leading zero byte.
  for (const ch of text) {
    if (ch !== "1") break;
    bytes.push(0);
  }
  return Uint8Array.from(bytes.reverse());
}
