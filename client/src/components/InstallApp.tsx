// "Install app" button. Uses the beforeinstallprompt event on Chromium; on iOS
// (which has no such event) it shows share-to-home-screen instructions instead.

import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { isStandalone } from "@/lib/notifications";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function InstallApp() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIos, setShowIos] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    if (isStandalone()) {
      setInstalled(true);
      return;
    }

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  // iOS Safari: no beforeinstallprompt — offer instructions instead.
  const isIos =
    typeof navigator !== "undefined" &&
    /iphone|ipad|ipod/i.test(navigator.userAgent) &&
    !isStandalone();

  if (installed) return null;

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    const choice = await deferred.userChoice;
    if (choice.outcome === "accepted") setInstalled(true);
    setDeferred(null);
  };

  return (
    <>
      {deferred && (
        <button
          type="button"
          onClick={install}
          className="flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/15"
        >
          <Download className="h-3 w-3" /> Install app
        </button>
      )}
      {isIos && !deferred && (
        <button
          type="button"
          onClick={() => setShowIos(true)}
          className="flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/15"
        >
          <Download className="h-3 w-3" /> Install app
        </button>
      )}
      {showIos && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-lg">
            <div className="mb-3 flex items-start justify-between">
              <h3 className="text-sm font-semibold">Install Dayline</h3>
              <button
                type="button"
                onClick={() => setShowIos(false)}
                aria-label="Close"
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
              <li>
                Tap the <span className="font-medium text-foreground">Share</span> button in Safari.
              </li>
              <li>
                Choose{" "}
                <span className="font-medium text-foreground">Add to Home Screen</span>.
              </li>
              <li>Tap Add — Dayline opens like a native app, offline included.</li>
            </ol>
          </div>
        </div>
      )}
    </>
  );
}
