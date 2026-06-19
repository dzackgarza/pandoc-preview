// Embedded Mozilla pdf.js viewer driver (Phase F / F1 / P107). App-owned UI: a
// thin wrapper over the maintained pdfjs-dist library that loads a PDF from an
// asset-protocol URL and paints each page into a <canvas>. We do NOT write a PDF
// renderer — pdf.js owns all parsing/painting; this module only wires its worker
// and asset URLs to OFFLINE app resources (never a CDN, the MathJax precedent)
// and drives getDocument → getPage → render.

import * as pdfjsLib from "pdfjs-dist";
// Vite emits the pdf.js worker as a hashed asset under dist/ that the webview's
// own custom protocol serves OFFLINE — never a CDN. The `?url` import yields that
// emitted asset's URL, which is exactly what GlobalWorkerOptions.workerSrc needs.
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

// Render every page of the PDF in `data` into `container`, one <canvas> per
// page. `data` is the PDF's raw bytes (read through the host-fs IPC boundary —
// pdf.js parses them directly). `cMapUrl` / `standardFontDataUrl` are
// asset-protocol URLs of the VENDORED offline pdf.js asset dirs (resolved by the
// caller via resolveResource + convertFileSrc) so CID/Type0 fonts and the
// standard 14 fonts resolve with no network. Clears any prior pages first so a
// recompile repaints cleanly. Throws loudly on a parse failure — a non-PDF blob
// is a hard error, never a blank pane.
export async function renderPdfToContainer(
  container: HTMLElement,
  data: ArrayBuffer,
  cMapUrl: string,
  standardFontDataUrl: string,
): Promise<number> {
  const loadingTask = pdfjsLib.getDocument({
    // A fresh view each call: pdf.js transfers the buffer to its worker, so a
    // retained ArrayBuffer must not be reused detached.
    data: new Uint8Array(data),
    cMapUrl,
    cMapPacked: true,
    standardFontDataUrl,
  });
  const pdf = await loadingTask.promise;
  // Clear prior render (a recompile repaints from scratch).
  container.replaceChildren();

  const outputScale = window.devicePixelRatio || 1;
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("pdf.js viewer: 2D canvas context unavailable");
    canvas.width = Math.floor(viewport.width * outputScale);
    canvas.height = Math.floor(viewport.height * outputScale);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;
    canvas.className = "mx-auto my-2 block shadow";
    container.appendChild(canvas);
    const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined;
    await page.render({ canvas, canvasContext: context, viewport, transform }).promise;
    page.cleanup();
  }
  return pdf.numPages;
}
