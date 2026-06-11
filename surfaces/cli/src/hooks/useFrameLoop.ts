import { useEffect, useState } from "react";
import { useDelight } from "../components/DelightProvider.js";

// A frame-index ticker — the heartbeat behind every animation (mascot blink, gradient
// sweep, spinners, dance). Returns the current frame; when delight is off it stays at 0
// so the consumer renders a single static frame. `loop=false` runs once then stops.
export function useFrameLoop(frameCount: number, fps = 6, loop = true): number {
  const { animate } = useDelight();
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!animate || frameCount <= 1) return;
    const id = setInterval(() => {
      setFrame((f) => {
        const next = f + 1;
        if (!loop && next >= frameCount) {
          clearInterval(id);
          return frameCount - 1;
        }
        return next % frameCount;
      });
    }, 1000 / fps);
    return () => clearInterval(id);
  }, [animate, frameCount, fps, loop]);

  return animate ? frame : 0;
}
