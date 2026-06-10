// Compose multiple ValidationAdapters into one sequential pipeline.
//
// The composed adapter runs each adapter in order.  By default it is
// fail-fast: if an adapter returns errors, subsequent adapters are skipped
// (the skill has already failed; no point running expensive checks).
// Set `failFast: false` to collect issues from all adapters regardless.

import {
  type ValidationAdapter,
  type ValidationResult,
  emptyResult,
} from "./types.js";

export interface ComposeOptions {
  /** If true (default), stop after the first adapter that produces errors. */
  failFast?: boolean;
}

/**
 * Compose multiple adapters into a single pipeline.
 *
 * @example
 * const validator = compose(defaultValidator, createSecurityLlmAdapter(myFn));
 * await publishSkill(conn, signer, input, { validator });
 */
export function compose(
  ...args: (ValidationAdapter | ComposeOptions)[]
): ValidationAdapter {
  // Separate options from adapters
  let adapters: ValidationAdapter[];
  let opts: ComposeOptions = { failFast: true };

  const last = args[args.length - 1];
  if (last && typeof (last as ValidationAdapter).validate !== "function") {
    // Last arg is an options object
    opts = last as ComposeOptions;
    adapters = args.slice(0, -1) as ValidationAdapter[];
  } else {
    adapters = args as ValidationAdapter[];
  }

  const { failFast = true } = opts;

  return {
    id: `composed(${adapters.map((a) => a.id).join(",")})`,

    async validate(skillMd: string): Promise<ValidationResult> {
      const merged: ValidationResult = emptyResult();

      for (const adapter of adapters) {
        const r = await adapter.validate(skillMd);

        merged.errors.push(...r.errors);
        merged.warnings.push(...r.warnings);
        merged.infos.push(...r.infos);

        if (r.errors.length > 0) {
          merged.ok = false;
          if (failFast) break;
        }
      }

      return merged;
    },
  };
}
