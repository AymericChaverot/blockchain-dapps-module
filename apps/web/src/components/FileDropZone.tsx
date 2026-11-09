import { FileUpIcon } from "lucide-react";
import { useRef, useState } from "react";

import { cn } from "@/lib/utils";

export interface DroppedFile {
  name: string;
  bytes: Uint8Array;
}

/** Drag & drop (or click) a PDF/JSON file; its bytes never leave the browser. */
export function FileDropZone({
  onFile,
  label = "Check the worker's certificate file",
  hint = "Drop it here or tap to choose it. It is checked on this device and never uploaded.",
  compact = false,
}: {
  onFile: (file: DroppedFile) => void;
  label?: string;
  hint?: string;
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  async function handle(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    onFile({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
  }

  return (
    <button
      type="button"
      onClick={() => inputRef.current?.click()}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        void handle(event.dataTransfer.files);
      }}
      className={cn(
        "border-input hover:border-primary/60 hover:bg-primary/5 flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed text-center transition-colors",
        compact ? "p-4" : "p-4 sm:p-8",
        dragging && "border-primary bg-primary/10",
      )}
    >
      <FileUpIcon className={cn("text-primary", compact ? "size-6" : "size-8")} />
      <span className="font-medium">{label}</span>
      <span className="text-muted-foreground text-xs">{hint}</span>
      <input
        ref={inputRef}
        type="file"
        accept=".json,.pdf,application/json,application/pdf"
        className="hidden"
        onChange={(event) => {
          void handle(event.target.files);
          event.target.value = "";
        }}
      />
    </button>
  );
}
