import { useEffect, useRef, useState } from "react";
import "./question-image.css";
import { HighlightImage } from "./AttemptHighlights";

export function QuestionImage({ src, alt, width, height, block = "image:0" }: { src: string; alt: string; width?: number; height?: number; block?: string }) {
  const [open, setOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) dialog.current?.showModal();
  }, [open]);
  const close = () => { setOpen(false); setZoom(1); trigger.current?.focus(); };
  return <span className="question-image">
    <HighlightImage block={block}><img className="question-content__image-asset" src={src} alt={alt} width={width} height={height} loading="eager" decoding="async" draggable={false} /></HighlightImage>
    <button ref={trigger} type="button" className="question-image__zoom" aria-label={`Zoom image: ${alt}`}
      onClick={event => { event.preventDefault(); event.stopPropagation(); setOpen(true); }}>Zoom image</button>
    {open && <dialog ref={dialog} className="question-image-dialog" aria-label={alt}
      onClick={event => event.stopPropagation()} onCancel={close} onClose={close}>
      <div className="question-image-dialog__controls">
        <button type="button" onClick={() => setZoom(value => Math.max(1, value - .5))} disabled={zoom === 1}>Zoom out</button>
        <output aria-label="Image zoom">{Math.round(zoom * 100)}%</output>
        <button type="button" onClick={() => setZoom(value => Math.min(4, value + .5))} disabled={zoom === 4}>Zoom in</button>
        <button type="button" onClick={() => setZoom(1)}>Fit image</button>
        <button type="button" onClick={close} autoFocus>Close image</button>
      </div>
      <div className="question-image-dialog__viewport" tabIndex={0} aria-label="Zoomed question image">
        <img src={src} alt={alt} style={{ width: `${zoom * 100}%`, maxWidth: "none" }} />
      </div>
    </dialog>}
  </span>;
}
