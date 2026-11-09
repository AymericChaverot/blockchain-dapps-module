/**
 * QR decoding from a <video> element.
 *
 * Uses the native BarcodeDetector when the browser has one (Chrome on
 * Android, most desktop Chromium) and falls back to jsQR, loaded on demand,
 * elsewhere (Safari on iOS, Firefox).
 */
export type QrDecoder = (video: HTMLVideoElement) => Promise<string | undefined>;

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}

interface BarcodeDetectorConstructor {
  new (options: { formats: string[] }): BarcodeDetectorLike;
  getSupportedFormats(): Promise<string[]>;
}

async function nativeDecoder(): Promise<QrDecoder | undefined> {
  const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
  if (!Detector) return undefined;
  try {
    if (!(await Detector.getSupportedFormats()).includes("qr_code")) return undefined;
    const detector = new Detector({ formats: ["qr_code"] });
    return async (video) => (await detector.detect(video))[0]?.rawValue;
  } catch {
    return undefined;
  }
}

async function jsQrDecoder(): Promise<QrDecoder> {
  const { default: jsQR } = await import("jsqr");
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas is not available in this browser.");
  return async (video) => {
    const { videoWidth: width, videoHeight: height } = video;
    if (!width || !height) return undefined;
    // Downscale: faster, and plenty for a QR code filling the viewfinder.
    const scale = Math.min(1, 720 / Math.max(width, height));
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(image.data, image.width, image.height, { inversionAttempts: "attemptBoth" })?.data;
  };
}

export async function createQrDecoder(): Promise<QrDecoder> {
  return (await nativeDecoder()) ?? jsQrDecoder();
}
