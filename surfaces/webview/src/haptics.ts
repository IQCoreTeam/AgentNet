// One place for every WebView haptic. navigator.vibrate is unsupported on desktop
// browsers and many WebViews, so every call is wrapped — a no-op there, a buzz on the
// Android device (VIBRATE permission is in the manifest). Named by intent, not duration,
// so callers read as "what happened" instead of magic numbers.
type Pattern = number | number[];

function buzz(pattern: Pattern): void {
  try { navigator.vibrate?.(pattern); } catch { /* unsupported on this WebView */ }
}

export const haptics = {
  tap: () => buzz(12),                  // light: drawer slides closed, generic confirm
  longPress: () => buzz(15),            // sessions long-press menu opens
  castStart: () => buzz([10, 40, 10]),  // light double tap when a skill starts casting
  forge: () => buzz(40),                // medium: forge (publish_skill) approval appears
  celebrate: () => buzz([40, 30, 40, 30, 40, 30, 220]), // the success "zap"
};
