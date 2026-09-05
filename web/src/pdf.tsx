import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import type { Region } from "./types";
import { suggestRegion } from "./region-suggestions";

export async function suggestPageRegion(
  document: PDFDocumentProxy,
  pageNumber: number,
  questionNumber: number,
) {
  const page = await document.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const anchors = content.items.flatMap((item) => {
    if (!("str" in item)) return [];
    const [x, y] = viewport.convertToViewportPoint(
      item.transform[4],
      item.transform[5],
    );
    return [
      {
        text: item.str,
        x: x / viewport.width,
        y: (y - item.height) / viewport.height,
      },
    ];
  });
  return suggestRegion(anchors, pageNumber, questionNumber);
}

const documents = new Map<string, Promise<PDFDocumentProxy>>();
const crops = new WeakMap<PDFDocumentProxy, Map<string, Promise<string>>>();

export function loadPdf(url: string): Promise<PDFDocumentProxy> {
  const existing = documents.get(url);
  if (existing) return existing;
  const loading = import("pdfjs-dist")
    .then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      return pdfjs.getDocument({ url, enableXfa: false }).promise;
    })
    .catch((error) => {
      documents.delete(url);
      throw error;
    });
  documents.set(url, loading);
  // Keep the current and most recent document for player/results transitions.
  if (documents.size > 2) {
    const oldest = documents.keys().next().value!;
    const retired = documents.get(oldest)!;
    documents.delete(oldest);
    void retired
      .then(async (document) => {
        for (const crop of crops.get(document)?.values() ?? []) {
          void crop.then(URL.revokeObjectURL).catch(() => {});
        }
        await document.loadingTask.destroy();
      })
      .catch(() => {});
  }
  return loading;
}

function cropKey(region: Region) {
  return [
    region.pageNumber,
    region.x,
    region.y,
    region.width,
    region.height,
  ].join(":");
}

export function renderRegion(
  document: PDFDocumentProxy,
  region: Region,
): Promise<string> {
  let cache = crops.get(document);
  if (!cache) {
    cache = new Map();
    crops.set(document, cache);
  }
  const key = cropKey(region);
  const existing = cache.get(key);
  if (existing) return existing;
  const rendering = (async () => {
    const page = await document.getPage(region.pageNumber);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = window.document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(viewport.width * region.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height * region.height));
    if (canvas.width * canvas.height > 16_000_000)
      throw new Error("Question Region is too large to render safely.");
    try {
      await page.render({
        canvas,
        canvasContext: canvas.getContext("2d")!,
        viewport,
        transform: [
          1,
          0,
          0,
          1,
          -region.x * viewport.width,
          -region.y * viewport.height,
        ],
      }).promise;
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (value) =>
            value
              ? resolve(value)
              : reject(new Error("Question Region rendering failed.")),
          "image/png",
        ),
      );
      return URL.createObjectURL(blob);
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  })().catch((error) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, rendering);
  return rendering;
}

export async function prepareQuestionRegions(
  url: string,
  regions: Region[],
  onProgress: (done: number) => void,
) {
  const document = await loadPdf(url);
  for (const [index, region] of regions.entries()) {
    const image = new Image();
    image.src = await renderRegion(document, region);
    await image.decode();
    onProgress(index + 1);
  }
}

export function usePdf(url: string | null) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    setDocument(null);
    setError("");
    void loadPdf(url)
      .then((loaded) => {
        if (loaded && !cancelled) setDocument(loaded);
      })
      .catch(() => {
        if (!cancelled) setError("The Source PDF could not be rendered.");
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return { document, error };
}

export function PdfPage({
  document,
  pageNumber,
  regions = [],
  onDraw,
}: {
  document: PDFDocumentProxy | null;
  pageNumber: number;
  regions?: Region[];
  onDraw?: (region: Region) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const [draft, setDraft] = useState<Region | null>(null);
  const [renderError, setRenderError] = useState("");

  useEffect(() => {
    if (!document || !canvasRef.current) return;
    let renderTask: RenderTask | null = null;
    let cancelled = false;
    setRenderError("");
    document
      .getPage(pageNumber)
      .then(async (page) => {
        if (cancelled) return;
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        renderTask = page.render({
          canvas,
          canvasContext: canvas.getContext("2d")!,
          viewport,
        });
        await renderTask.promise;
      })
      .catch(() => {
        if (!cancelled) setRenderError("This PDF page could not be rendered.");
      });
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [document, pageNumber]);

  const position = (event: React.PointerEvent) => {
    const bounds = overlayRef.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
      y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)),
    };
  };

  const pointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!onDraw || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStart.current = position(event);
    setDraft({
      pageNumber,
      ...dragStart.current,
      width: 0,
      height: 0,
      confirmed: false,
    });
  };

  const pointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStart.current || !onDraw) return;
    const end = position(event);
    setDraft({
      pageNumber,
      x: Math.min(dragStart.current.x, end.x),
      y: Math.min(dragStart.current.y, end.y),
      width: Math.abs(end.x - dragStart.current.x),
      height: Math.abs(end.y - dragStart.current.y),
      confirmed: false,
    });
  };

  const pointerUp = () => {
    if (draft && onDraw && draft.width > 0.015 && draft.height > 0.015)
      onDraw(draft);
    dragStart.current = null;
    setDraft(null);
  };

  return (
    <div className={`pdf-page ${onDraw ? "pdf-page--drawing" : ""}`}>
      {renderError && <p role="alert">{renderError}</p>}
      <canvas ref={canvasRef} />
      <div
        ref={overlayRef}
        className="pdf-page__overlay"
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
      >
        {[...regions, ...(draft ? [draft] : [])].map((region, index) => (
          <span
            className={`region-box ${index === regions.length ? "region-box--draft" : ""}`}
            key={region.id ?? `${region.pageNumber}-${index}`}
            style={{
              left: `${region.x * 100}%`,
              top: `${region.y * 100}%`,
              width: `${region.width * 100}%`,
              height: `${region.height * 100}%`,
            }}
          >
            {index < regions.length ? index + 1 : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

export function RegionCrop({
  document,
  region,
  alt = "Question Region from the Source PDF",
}: {
  document: PDFDocumentProxy | null;
  region: Region;
  alt?: string;
}) {
  const [source, setSource] = useState("");
  const [error, setError] = useState("");
  const key = cropKey(region);
  useEffect(() => {
    if (!document) return;
    let cancelled = false;
    setSource("");
    setError("");
    void renderRegion(document, region)
      .then((url) => {
        if (!cancelled) setSource(url);
      })
      .catch(() => {
        if (!cancelled) setError("Question Region could not be rendered.");
      });
    return () => {
      cancelled = true;
    };
  }, [document, key]);
  if (error) return <p role="alert">{error}</p>;
  return source ? (
    <img
      className="region-crop"
      src={source}
      alt={alt}
    />
  ) : null;
}
