import { AnimatePresence, motion } from "motion/react";
import { ExternalLink, KeyRound, ShieldCheck, X } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/motion/button/base";
import { Input } from "@/components/motion/input";
import { Switch } from "@/components/motion/switch";
import { EASE_OUT } from "@/lib/ease";
import { dollars, estimateCost } from "@/lib/studio/cost";
import { looksLikeKey, setFalKey, verifyKey } from "@/lib/studio/fal";

export function KeyDialog({ open, onClose, onConnected }: { open: boolean; onClose: () => void; onConnected: () => void }) {
  const [value, setValue] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | false>(false);
  const [checking, setChecking] = useState(false);

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    if (!looksLikeKey(value)) {
      setError("That doesn't look like a fal key (it has the form id:secret)");
      return;
    }
    setChecking(true);
    const r = await verifyKey(value);
    setChecking(false);
    if (r === "invalid") {
      setError("fal didn't accept this key");
      return;
    }
    setFalKey(value, remember);
    setValue("");
    setError(false);
    onConnected();
  }

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-background/70 px-4 py-6 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.form
            onSubmit={connect}
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.25, ease: EASE_OUT }}
            className="relative flex w-full max-w-md flex-col gap-5 rounded-3xl border border-border bg-card p-6 shadow-xl"
          >
            <button type="button" onClick={onClose} aria-label="Close" className="absolute top-4 right-4 grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground">
              <X className="size-4" />
            </button>
            <div className="flex items-start gap-3 pr-8">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-muted">
                <KeyRound className="size-4" />
              </span>
              <div>
                <h2 className="text-base font-medium">Connect your fal key</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Storycast makes every film on fal with your own key, so generations are billed to your fal account. A one-minute film
                  costs about {dollars(estimateCost(1).total)}; you see the estimate before every film.
                </p>
              </div>
            </div>

            <Input type="password" label="fal key" value={value} onChange={(v) => (setValue(v), setError(false))} placeholder="xxxxxxxx-xxxx-…:xxxxxxxx" error={error} autoFocus reserveErrorLine autoComplete="off" spellCheck={false} />

            <div className="flex items-center justify-between gap-4 rounded-2xl border border-border px-4 py-3">
              <div>
                <p className="text-sm">Remember on this device</p>
                <p className="text-xs text-muted-foreground">{remember ? "Kept until you disconnect it" : "Forgotten when you close this tab"}</p>
              </div>
              <Switch checked={remember} onCheckedChange={setRemember} ariaLabel="Remember the key on this device" />
            </div>

            <Button type="submit" disabled={!value || checking}>
              {checking ? "Checking with fal…" : "Connect"}
            </Button>

            <div className="flex flex-col gap-2 text-xs text-muted-foreground">
              <p className="flex items-start gap-2">
                <ShieldCheck className="mt-px size-3.5 shrink-0" />
                Your key stays in this browser and is sent only to fal. Storycast has no server that sees it.
              </p>
              <a href="https://fal.ai/dashboard/keys" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-foreground hover:underline">
                Get a key from your fal dashboard <ExternalLink className="size-3" />
              </a>
            </div>
          </motion.form>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
