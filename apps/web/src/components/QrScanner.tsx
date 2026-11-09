import * as DialogPrimitive from "@radix-ui/react-dialog";
import { CameraOffIcon, FlashlightIcon, FlashlightOffIcon, KeyboardIcon, Loader2Icon, ScanLineIcon, XIcon } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createQrDecoder } from "@/lib/qrDecoder";
import { type ScannedCode, parseScannedCode } from "@/lib/scan";
import { cn } from "@/lib/utils";

/**
 * Return `true` to accept the code (the scanner closes), or a message to show
 * while scanning continues (e.g. "This is not a credential code").
 */
export type ScanHandler = (code: ScannedCode) => true | string;

type CameraState =
  | { status: "starting" }
  | { status: "scanning" }
  | { status: "error"; title: string; message: string };

function cameraError(error: unknown): CameraState {
  const name = (error as Error)?.name;
  if (!window.isSecureContext) {
    return {
      status: "error",
      title: "Camera needs a secure connection",
      message: "Open SitePass over https (or on localhost) to use the camera.",
    };
  }
  if (name === "NotAllowedError" || name === "SecurityError") {
    return {
      status: "error",
      title: "Camera access was refused",
      message: "Allow camera access for this site in your browser settings, then try again.",
    };
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return { status: "error", title: "No camera found", message: "This device has no available camera." };
  }
  return {
    status: "error",
    title: "Camera unavailable",
    message: (error as Error)?.message ?? "The camera could not be started.",
  };
}

function Viewfinder({ onScan, onClose }: { onScan: ScanHandler; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<MediaStreamTrack | undefined>(undefined);
  const [state, setState] = useState<CameraState>({ status: "starting" });
  const [feedback, setFeedback] = useState<string>();
  const [torch, setTorch] = useState<{ available: boolean; on: boolean }>({ available: false, on: false });
  const handler = useRef(onScan);
  handler.current = onScan;

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | undefined;
    let timer: number | undefined;
    let lastRejected = "";

    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error("No camera API"), { name: "SecurityError" });
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        if (stopped) return;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        const track = stream.getVideoTracks()[0];
        trackRef.current = track;
        const capabilities = (track.getCapabilities?.() ?? {}) as { torch?: boolean };
        setTorch({ available: !!capabilities.torch, on: false });
        setState({ status: "scanning" });

        const decode = await createQrDecoder();
        const tick = async () => {
          if (stopped) return;
          try {
            const text = await decode(video);
            if (text && text !== lastRejected) {
              const outcome = handler.current(parseScannedCode(text));
              if (outcome === true) {
                navigator.vibrate?.(60);
                return;
              }
              lastRejected = text;
              setFeedback(outcome);
            }
          } catch {
            // A frame that cannot be decoded: keep scanning.
          }
          timer = window.setTimeout(tick, 120);
        };
        void tick();
      } catch (error) {
        if (!stopped) setState(cameraError(error));
      }
    }

    void start();
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
      for (const track of stream?.getTracks() ?? []) track.stop();
    };
  }, []);

  async function toggleTorch() {
    const track = trackRef.current;
    if (!track) return;
    const next = !torch.on;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorch({ available: true, on: next });
    } catch {
      setTorch({ available: false, on: false });
    }
  }

  return (
    <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black">
      <video ref={videoRef} className="absolute inset-0 size-full object-cover" playsInline muted />

      {state.status === "scanning" && (
        <>
          {/* Dimmed surroundings and a square target. */}
          <div className="pointer-events-none relative aspect-square w-[min(72vw,320px)] rounded-2xl shadow-[0_0_0_9999px_rgb(0_0_0/0.55)]">
            <span className="absolute -top-0.5 -left-0.5 size-10 rounded-tl-2xl border-t-4 border-l-4 border-white" />
            <span className="absolute -top-0.5 -right-0.5 size-10 rounded-tr-2xl border-t-4 border-r-4 border-white" />
            <span className="absolute -bottom-0.5 -left-0.5 size-10 rounded-bl-2xl border-b-4 border-l-4 border-white" />
            <span className="absolute -right-0.5 -bottom-0.5 size-10 rounded-br-2xl border-r-4 border-b-4 border-white" />
            <span className="absolute inset-x-6 top-1/2 h-0.5 animate-pulse bg-white/70" />
          </div>
          {feedback && (
            <div className="absolute inset-x-4 bottom-24 mx-auto max-w-sm rounded-lg bg-black/75 px-4 py-3 text-center text-sm text-white">
              {feedback}
            </div>
          )}
          {torch.available && (
            <Button
              type="button"
              size="icon"
              variant="secondary"
              className="absolute right-4 bottom-6 size-12 rounded-full"
              onClick={toggleTorch}
              aria-label={torch.on ? "Turn the light off" : "Turn the light on"}
            >
              {torch.on ? <FlashlightOffIcon className="size-5" /> : <FlashlightIcon className="size-5" />}
            </Button>
          )}
        </>
      )}

      {state.status === "starting" && (
        <div className="relative flex flex-col items-center gap-3 text-white/90">
          <Loader2Icon className="size-8 animate-spin" />
          <span className="text-sm">Starting the camera…</span>
        </div>
      )}

      {state.status === "error" && (
        <div className="relative flex max-w-sm flex-col items-center gap-3 px-6 text-center text-white">
          <span className="flex size-14 items-center justify-center rounded-full bg-white/10">
            <CameraOffIcon className="size-7" />
          </span>
          <div className="text-lg font-semibold">{state.title}</div>
          <p className="text-sm text-white/80">{state.message}</p>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      )}
    </div>
  );
}

function ManualEntry({ placeholder, onScan }: { placeholder: string; onScan: ScanHandler }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string>();
  function submit(event: FormEvent) {
    event.preventDefault();
    const outcome = onScan(parseScannedCode(value));
    if (outcome !== true) setError(outcome);
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Input
          autoFocus
          className="font-mono"
          placeholder={placeholder}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setError(undefined);
          }}
        />
        <Button type="submit" disabled={!value.trim()}>
          OK
        </Button>
      </div>
      {error && <span className="text-destructive text-sm">{error}</span>}
    </form>
  );
}

export function QrScannerDialog({
  open,
  onOpenChange,
  title,
  hint,
  manualPlaceholder = "Paste the code or link",
  onScan,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  hint: string;
  manualPlaceholder?: string;
  onScan: ScanHandler;
}) {
  const [manual, setManual] = useState(false);
  useEffect(() => {
    if (!open) setManual(false);
  }, [open]);

  const handle: ScanHandler = (code) => {
    const outcome = onScan(code);
    if (outcome === true) onOpenChange(false);
    return outcome;
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/70" />
        <DialogPrimitive.Content
          className={cn(
            "bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed z-50 flex flex-col overflow-hidden",
            // Full screen on phones, centered panel on larger screens.
            "inset-0 sm:inset-auto sm:top-1/2 sm:left-1/2 sm:h-[min(640px,90dvh)] sm:w-[min(480px,92vw)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:border sm:shadow-xl",
          )}
        >
          <div className="flex items-start gap-3 border-b px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
            <ScanLineIcon className="text-primary mt-0.5 size-5 shrink-0" />
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="font-semibold">{title}</DialogPrimitive.Title>
              <DialogPrimitive.Description className="text-muted-foreground text-sm">{hint}</DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close">
                <XIcon className="size-5" />
              </Button>
            </DialogPrimitive.Close>
          </div>

          {open && !manual && <Viewfinder onScan={handle} onClose={() => onOpenChange(false)} />}
          {manual && (
            <div className="flex-1 p-4">
              <ManualEntry placeholder={manualPlaceholder} onScan={handle} />
            </div>
          )}

          <div className="border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <Button variant="ghost" className="w-full" onClick={() => setManual((value) => !value)}>
              {manual ? <ScanLineIcon /> : <KeyboardIcon />} {manual ? "Use the camera" : "Enter the code manually"}
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Button that opens the scanner. */
export function ScanButton({
  children,
  className,
  size = "xl",
  variant = "default",
  ...scanner
}: {
  children: ReactNode;
  className?: string;
  size?: "default" | "sm" | "lg" | "xl";
  variant?: "default" | "outline" | "secondary";
  title: string;
  hint: string;
  manualPlaceholder?: string;
  onScan: ScanHandler;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" size={size} variant={variant} className={className} onClick={() => setOpen(true)}>
        {children}
      </Button>
      <QrScannerDialog open={open} onOpenChange={setOpen} {...scanner} />
    </>
  );
}
