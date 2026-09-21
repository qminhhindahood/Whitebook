import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Overlay } from "./ui";

export function ReferenceSheet({ onClose }: { onClose: () => void }) {
  const viewer = useRef<HTMLDivElement>(null);
  const scale = useRef(1);
  const anchor = useRef<{ x: number; y: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [aspect, setAspect] = useState(1.5);
  const [width, setWidth] = useState(0);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);

  const changeZoom = (next: number, x: number, y: number) => {
    const element = viewer.current;
    if (!element) return;
    next = Math.max(1, Math.min(4, next));
    const ratio = next / scale.current;
    anchor.current = {
      x: (element.scrollLeft + x) * ratio - x,
      y: (element.scrollTop + y) * ratio - y,
    };
    scale.current = next;
    setZoom(next);
  };

  useEffect(() => {
    const element = viewer.current!;
    const resize = () => setWidth(element.clientWidth);
    resize();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    observer?.observe(element);
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const bounds = element.getBoundingClientRect();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1);
      changeZoom(scale.current * Math.exp(-delta * 0.002), event.clientX - bounds.left, event.clientY - bounds.top);
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => {
      observer?.disconnect();
      element.removeEventListener("wheel", wheel);
    };
  }, []);

  useLayoutEffect(() => {
    if (!anchor.current || !viewer.current) return;
    viewer.current.scrollLeft = anchor.current.x;
    viewer.current.scrollTop = anchor.current.y;
  }, [zoom]);

  return (
    <Overlay title="Reference Sheet" onClose={onClose} className="reference-overlay" style={{ "--reference-aspect": aspect } as CSSProperties}>
      <div className="reference-controls">
        <span>Scroll to zoom · Drag to move</span>
        <output aria-label="Reference zoom">{Math.round(zoom * 100)}%</output>
        <button type="button" onClick={() => changeZoom(1, 0, 0)}>Reset zoom</button>
      </div>
      <div
        ref={viewer}
        className="reference-sheet"
        role="region"
        aria-label="Zoomable reference sheet"
        tabIndex={0}
        onKeyDown={(event) => {
          if (["+", "=", "-", "0"].includes(event.key)) {
            event.preventDefault();
            changeZoom(event.key === "0" ? 1 : scale.current * (event.key === "-" ? 1 / 1.2 : 1.2), event.currentTarget.clientWidth / 2, event.currentTarget.clientHeight / 2);
          }
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { x: event.clientX, y: event.clientY, left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop };
        }}
        onPointerMove={(event) => {
          if (!drag.current) return;
          event.currentTarget.scrollLeft = drag.current.left + drag.current.x - event.clientX;
          event.currentTarget.scrollTop = drag.current.top + drag.current.y - event.clientY;
        }}
        onPointerUp={(event) => { event.currentTarget.releasePointerCapture(event.pointerId); drag.current = null; }}
        onLostPointerCapture={() => { drag.current = null; }}
      >
        <img
          src="/api/math/reference-sheet.png"
          alt="Math Reference Sheet"
          draggable={false}
          onLoad={(event) => setAspect(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight)}
          style={{ width: width ? width * zoom : `${zoom * 100}%` }}
        />
      </div>
    </Overlay>
  );
}
