// The login URL block shared by the Connect Claude / Connect Codex screens. Shows the
// OAuth URL as a tappable link (authorize right here), with two helpers underneath:
//   - Copy link  → paste it on another device you're already signed in on.
//   - Show QR    → swaps the link for a QR of the SAME url, so a SECOND phone can scan
//                  it (handy when this is a sub-phone and you're signed in on your main).
// The QR is rendered locally (qrcode.react → inline SVG), never sent to any service —
// the URL carries the login secret, so it must not leave the device.

import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { OnboardingButton } from "./OnboardingShell";

export function LoginUrlBlock({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // clipboard API can be blocked; fall back to a hidden textarea + execCommand
      const ta = document.createElement("textarea");
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <>
      {showQr ? (
        // Light background + dark modules: scanners expect dark-on-light, and our UI is dark.
        <div className="flex justify-center rounded-lg bg-white p-4 ring-1 ring-zinc-800">
          <QRCodeSVG value={url} size={220} level="M" marginSize={0} />
        </div>
      ) : (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="break-all rounded-lg bg-zinc-900 px-3 py-2.5 text-xs leading-relaxed text-[#00E673] ring-1 ring-zinc-800"
        >
          {url}
        </a>
      )}
      <div className="flex gap-2">
        <OnboardingButton variant="outline" className="flex-1" onClick={copyUrl}>
          {copied ? "Copied!" : "Copy link"}
        </OnboardingButton>
        <OnboardingButton variant="outline" className="flex-1" onClick={() => setShowQr((v) => !v)}>
          {showQr ? "Show link" : "Show QR code"}
        </OnboardingButton>
      </div>
    </>
  );
}
