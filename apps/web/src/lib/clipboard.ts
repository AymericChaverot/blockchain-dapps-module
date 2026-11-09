import { toast } from "sonner";

/** Copies `value` and reports the outcome in a toast (clipboard access can be refused). */
export async function copyWithToast(value: string, success: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(success);
    return true;
  } catch {
    toast.error("Could not copy to the clipboard", { description: "Your browser refused clipboard access." });
    return false;
  }
}

export const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

/**
 * Opens the phone's share sheet (SMS, WhatsApp, e-mail…) when available,
 * otherwise copies the link.
 */
export async function shareLink(url: string, title: string, copied = "Link copied"): Promise<void> {
  if (canShare) {
    try {
      await navigator.share({ title, url });
      return;
    } catch (error) {
      if ((error as Error).name === "AbortError") return;
    }
  }
  await copyWithToast(url, copied);
}
