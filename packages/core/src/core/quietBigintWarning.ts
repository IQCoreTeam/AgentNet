// Silence ONE known-noise line: bigint-buffer's module-load warning (issue #187 F2).
//
// The npm bundle ships no native bigint_buffer addon, so the try/require at the top of
// bigint-buffer's node.js ALWAYS fails and console.warn's "bigint: Failed to load
// bindings, pure JS will be used (try npm run rebuild?)" on every spawn. The pure JS
// fallback is the expected path here, not something the operator can rebuild away, and
// on an MCP host that reads child stderr the line lands in front of the ready banner
// looking like an error. Multiplied by per-call spawning it is constant clutter.
//
// So: hook console.warn, swallow exactly that one line, and put the original back the
// moment it fires (the load warning fires at most once per process, at module load).
// Every other warning passes through untouched, before and after, so nothing real is
// hidden. Imported for its SIDE EFFECT as the first import of mcp-stdio.ts, which is
// what places the hook before @solana/web3.js pulls bigint-buffer in.

const realWarn = console.warn;
console.warn = (...args: unknown[]) => {
  if (typeof args[0] === "string" && args[0].startsWith("bigint: Failed to load bindings")) {
    console.warn = realWarn; // one shot: the noise fired, step out of the way
    return;
  }
  realWarn(...args);
};

export {}; // side-effect module: nothing to export, everything happens above
