// One place for every WebView haptic. navigator.vibrate is unsupported on desktop
// browsers and many WebViews, so every call is wrapped — a no-op there, a buzz on the
// Android device (VIBRATE permission is in the manifest). navigator.vibrate has no
// amplitude control, so intensity is duration: short reads as a tick, long as a thud.
type Pattern = number | number[];

function buzz(pattern: Pattern): void {
  try { navigator.vibrate?.(pattern); } catch { /* unsupported on this WebView */ }
}

export const haptics = {
  tick: () => buzz(8),                  // selection/nav: tab change, card tap, sheet close
  tap: () => buzz(12),                  // light confirm: drawer, send, approve
  press: () => buzz(25),                // attention: approval card appears, long-press menu
  strong: () => buzz(40),               // heavy confirm: on-chain submits, forge approval
  error: () => buzz([30, 60, 30]),      // failure / deny / blocked action
  castStart: () => buzz([10, 40, 10]),  // light double tap when a skill starts casting
  // Rising "swish" ladder. navigator.vibrate has no amplitude, so a rising feel is faked by
  // a pulse train whose gaps SHRINK and pulses GROW — it reads as an accelerating build into a
  // hit, not a flat buzz. Used across the onboarding tutorial so each step feels like it climbs.
  unlock: () => buzz([8, 18, 14, 14, 22, 12, 44]),               // progression unlock — one firm rise + snap
  step1: () => buzz([6, 24, 10, 18, 16, 12, 26]),                // first step clears — a light rise (씽↗)
  step2: () => buzz([6, 20, 12, 14, 22, 40, 10, 16, 18, 12, 34]), // second step clears — a double rise (씽 씽)
  celebrate: () => buzz([6, 20, 10, 16, 14, 12, 20, 10, 28, 8, 40, 60, 150]), // success — accelerating rise into a peak
};
