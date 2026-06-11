import React, { createContext, useContext } from "react";

// The single gate for ALL animation. Read the environment ONCE here; every hook and
// component asks this context "may I animate?" instead of re-checking flags. Guarantees
// a clean, identical "off" path for --calm, NO_COLOR, and piped/non-TTY output.
interface Delight {
  animate: boolean; // master switch: false → everything renders instantly, plain
}

const DelightContext = createContext<Delight>({ animate: false });

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
  return <DelightContext.Provider value={{ animate }}>{children}</DelightContext.Provider>;
}

export const useDelight = () => useContext(DelightContext);
