import { useEffect, useRef, useState } from "react";
import "./question-image.css";
import { HighlightImage } from "./AttemptHighlights";

export function QuestionImage({ src, alt, width, height, block = "image:0" }: { src: string; alt: string; width?: number; height?: number; block?: string }) {
  const [open, setOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [expanded, setExpanded] = useState(false);
  const [fitWidth, setFitWidth] = useState(width ?? 0);
  const viewport = useRef<HTMLSpanElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const measure = () => {
      const natural = image.current?.naturalWidth || width || 0;
      if (natural && viewport.current?.clientWidth) setFitWidth(Math.min(natural, viewport.current.clientWidth));
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (viewport.current) observer?.observe(viewport.current);
    const fullscreenChanged = () => { if (document.fullscreenElement !== dialog.current) setExpanded(false); };
    document.addEventListener("fullscreenchange", fullscreenChanged);
    return () => { observer?.disconnect(); document.removeEventListener("fullscreenchange", fullscreenChanged); };
  }, [src, width]);
  useEffect(() => {
    if (open) dialog.current?.showModal();
  }, [open]);
  const close = () => {
    if (document.fullscreenElement === dialog.current) void document.exitFullscreen?.();
    setOpen(false); setExpanded(false); trigger.current?.focus();
  };
  return <span className="question-image">
    <span ref={viewport} className="question-image__viewport"><HighlightImage block={block}><img ref={image} className="question-content__image-asset" src={src} alt={alt} width={width} height={height}
      onLoad={event => { if (viewport.current?.clientWidth) setFitWidth(Math.min(event.currentTarget.naturalWidth, viewport.current.clientWidth)); }}
      style={zoom === 1 ? undefined : { width: fitWidth ? fitWidth * zoom : `${zoom * 100}%`, maxWidth: "none" }} loading="eager" decoding="async" draggable={false} /></HighlightImage></span>
    <span className="question-image__controls" role="group" aria-label={`Figure controls: ${alt}`}>
      <button type="button" disabled={zoom === 1} onClick={() => setZoom(value => Math.max(1, value - .5))}>Zoom out</button>
      <output aria-label="Figure zoom">{Math.round(zoom * 100)}%</output>
      <button type="button" disabled={zoom === 4} onClick={() => setZoom(value => Math.min(4, value + .5))}>Zoom in</button>
      <button type="button" onClick={() => setZoom(1)}>Reset figure</button>
    <button ref={trigger} type="button" className="question-image__zoom" aria-label={`Zoom image: ${alt}`}
      onClick={event => { event.preventDefault(); event.stopPropagation(); setOpen(true); }}>Zoom image</button>
    </span>
    {open && <dialog ref={dialog} className={`question-image-dialog${expanded ? " question-image-dialog--fullscreen" : ""}`} aria-label={alt}
      onClick={event => event.stopPropagation()} onCancel={close} onClose={close}>
      <div className="question-image-dialog__controls">
        <button type="button" onClick={() => setZoom(value => Math.max(1, value - .5))} disabled={zoom === 1}>Zoom out</button>
        <output aria-label="Image zoom">{Math.round(zoom * 100)}%</output>
        <button type="button" onClick={() => setZoom(value => Math.min(4, value + .5))} disabled={zoom === 4}>Zoom in</button>
        <button type="button" onClick={() => setZoom(1)}>Fit image</button>
        <button type="button" aria-pressed={expanded} onClick={() => {
          if (expanded) { if (document.fullscreenElement === dialog.current) void document.exitFullscreen?.(); setExpanded(false); }
          else { setExpanded(true); void dialog.current?.requestFullscreen?.().catch(() => { /* Full viewport remains available. */ }); }
        }}>{expanded ? "Exit image fullscreen" : "Fullscreen image"}</button>
        <button type="button" onClick={close} autoFocus>Close image</button>
      </div>
      <div className="question-image-dialog__viewport" tabIndex={0} aria-label="Zoomed question image">
        <img src={src} alt={alt} style={{ width: `${zoom * 100}%`, maxWidth: "none" }} />
      </div>
    </dialog>}
  </span>;
}
