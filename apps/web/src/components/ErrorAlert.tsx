import { OctagonXIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { DecodedError } from "@/lib/errors";

/** Persistent display of the last revert, so it stays visible during the demo. */
export function ErrorAlert({ error }: { error?: DecodedError }) {
  if (!error) return null;
  return (
    <Alert variant="destructive">
      <OctagonXIcon />
      <AlertTitle>{error.title}</AlertTitle>
      <AlertDescription>
        <span>{error.description}</span>
        {error.raw && <code className="text-xs break-all">{error.raw}</code>}
      </AlertDescription>
    </Alert>
  );
}
