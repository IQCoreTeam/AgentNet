import React, { createContext, useContext, useMemo, useRef, useState } from "react";

// The single gate for ALL animation. Read the environment ONCE here; every hook and
// component asks this context "may I animate?" instead of re-checking flags. Guarantees
// a clean, identical "off" path for --calm, NO_COLOR, and piped/non-TTY output.
//
// `typing` pauses animation for a beat after each keystroke: every animation frame is a
// full ink repaint, and repaints mid-IME-composition (Hangul/CJK) make the terminal's
// preedit text flicker. Freezing the mascot/spinners while the user types keeps the
// frame byte-identical, so ink skips the write entirely and composition stays stable.
interface Delight {
  animate: boolean; // master switch: false → everything renders instantly, plain
  typing: boolean; // true for ~1.2s after the last composer keystroke
  noteTyping: () => void; // composer calls this on every keystroke
}

const DelightContext = createContext<Delight>({ animate: false, typing: false, noteTyping: () => {} });

export function DelightProvider({
  calm,
  children,
}: {
  calm?: boolean;
  children: React.ReactNode;
}) {
  const animate =
    !calm &&
    !process.env.AGENTNET_CALM &&
    !process.env.NO_COLOR &&
    Boolean(process.stdout.isTTY);
  const [typing, setTyping] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noteTyping = useRef(() => {
    setTyping(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setTyping(false), 1200);
  }).current;
  const value = useMemo(() => ({ animate, typing, noteTyping }), [animate, typing, noteTyping]);
  return <DelightContext.Provider value={value}>{children}</DelightContext.Provider>;
}

export const useDelight = () => useContext(DelightContext);
