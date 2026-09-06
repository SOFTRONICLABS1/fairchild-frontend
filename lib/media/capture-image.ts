const CAPTURE_TIMEOUT_MS = 15000;

/**
 * Reads a cross-origin image's bytes back out of the browser via canvas, for retailers whose
 * CDN blocks server-side fetches (Cloudflare bot challenges and similar) but which the user's
 * own browser can load fine — that's the whole premise: if it renders in the page, the browser
 * already got past whatever blocked our server.
 *
 * This only works when the image host also grants CORS (Access-Control-Allow-Origin) on that
 * response — a separate gate from the bot challenge. Without it, drawing the image taints the
 * canvas and toBlob throws a SecurityError. That's expected for some hosts, not a bug, so this
 * resolves to null on any failure rather than throwing — callers decide what "no capture" means.
 */
export async function captureImageAsFile(
  imageUrl: string,
  filename = "product-image.jpg"
): Promise<File | null> {
  try {
    const image = await loadImage(imageUrl);
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx || canvas.width === 0 || canvas.height === 0) return null;
    ctx.drawImage(image, 0, 0);

    const blob = await new Promise<Blob | null>((resolve) => {
      try {
        canvas.toBlob((result) => resolve(result), "image/jpeg", 0.92);
      } catch {
        // Tainted canvas (no CORS clearance) throws synchronously here.
        resolve(null);
      }
    });
    if (!blob) return null;

    return new File([blob], filename, { type: blob.type || "image/jpeg" });
  } catch {
    return null;
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timer = window.setTimeout(() => {
      image.src = "";
      reject(new Error("Image load timed out"));
    }, CAPTURE_TIMEOUT_MS);

    image.crossOrigin = "anonymous";
    image.onload = () => {
      window.clearTimeout(timer);
      resolve(image);
    };
    image.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error("Image failed to load"));
    };
    image.src = url;
  });
}
