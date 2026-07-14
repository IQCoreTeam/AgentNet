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
  unlock: () => buzz([60, 80, 60]),     // strong double buzz for a progression unlock
  castStart: () => buzz([10, 40, 10]),  // light double tap when a skill starts casting
  celebrate: () => buzz([40, 30, 40, 30, 40, 30, 220]), // the success "zap"
};
