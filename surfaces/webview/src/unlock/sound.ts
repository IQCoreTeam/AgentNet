const UNLOCK_SOUND_KEY = "agentnet.unlock.sound";

export function unlockSoundEnabled(): boolean {
  return typeof localStorage === "undefined" || localStorage.getItem(UNLOCK_SOUND_KEY) !== "off";
}

export function setUnlockSoundEnabled(enabled: boolean): void {
  localStorage.setItem(UNLOCK_SOUND_KEY, enabled ? "on" : "off");
}

export function playUnlockSound(): void {
  if (!unlockSoundEnabled()) return;
  try {
    const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;
    const context = new AudioContextCtor();
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.24);
    gain.connect(context.destination);
    const oscillator = context.createOscillator();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(440, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(740, context.currentTime + 0.16);
    oscillator.connect(gain);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.25);
    oscillator.addEventListener("ended", () => void context.close());
  } catch {
    // Audio follows the platform's media policy. Haptics still provide feedback.
  }
}
