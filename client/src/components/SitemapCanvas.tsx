import { useRef, useState, useCallback, useEffect, memo, useMemo } from "react";
import type { TreeNode } from "@/components/SitemapView";
import type { PageNode } from "@shared/schema";
import { screenshotUrl } from "@/lib/api";
import { FileText, FileImage, File, Globe } from "lucide-react";

const NODE_W = 240;
const NODE_H = 200;

/**
 * Isolated overlay for drawing a zoom-selection rectangle.
 * Keeps its drag state local so dragging does NOT re-render the
 * (expensive) node grid above.
 */
function ZoomSelectionOverlayImpl({
  containerRef,
  onComplete,
}: {
  containerRef: React.RefObject<HTMLDivElement>;
  onComplete: (rectClient: { x: number; y: number; w: number; h: number }) => void;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const rectRef = useRef<HTMLDivElement>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef<{ x: number; y: number } | null>(null);

  const getLocal = useCallback(
    (clientX: number, clientY: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return { x: clientX - rect.left, y: clientY - rect.top };
    },
    [containerRef]
  );

  const drawRect = useCallback(() => {
    rafRef.current = null;
    const el = rectRef.current;
    const start = startRef.current;
    const cur = pendingRef.current;
    if (!el || !start || !cur) return;
    const left = Math.min(start.x, cur.x);
    const top = Math.min(start.y, cur.y);
    const width = Math.abs(cur.x - start.x);
    const height = Math.abs(cur.y - start.y);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.width = `${width}px`;
    el.style.height = `${height}px`;
    el.style.display = width > 0 || height > 0 ? "block" : "none";
  }, []);

  const handleDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const p = getLocal(e.clientX, e.clientY);
      startRef.current = p;
      pendingRef.current = p;
      drawRect();
    },
    [drawRect, getLocal]
  );

  const handleMove = useCallback(
    (e: React.MouseEvent) => {
      if (!startRef.current) return;
      pendingRef.current = getLocal(e.clientX, e.clientY);
      if (rafRef.current == null) {
        rafRef.current = requestAnimationFrame(drawRect);
      }
    },
    [drawRect, getLocal]
  );

  const finish = useCallback(() => {
    const start = startRef.current;
    const cur = pendingRef.current;
    startRef.current = null;
    pendingRef.current = null;
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (rectRef.current) rectRef.current.style.display = "none";
    if (start && cur) {
      const x = Math.min(start.x, cur.x);
      const y = Math.min(start.y, cur.y);
      const w = Math.abs(cur.x - start.x);
      const h = Math.abs(cur.y - start.y);
      if (w > 12 && h > 12) onComplete({ x, y, w, h });
    }
  }, [onComplete]);

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0"
      style={{ cursor: "crosshair", zIndex: 50 }}
      onMouseDown={handleDown}
      onMouseMove={handleMove}
      onMouseUp={finish}
      onMouseLeave={finish}
      data-testid="zoom-selection-overlay"
    >
      <div
        ref={rectRef}
        className="absolute pointer-events-none"
        style={{
          display: "none",
          left: 0,
          top: 0,
          width: 0,
          height: 0,
          // Bright, hard-coded colors so they render regardless of theme
          // variable resolution. NO box-shadow — a 9999px spread repaints on
          // every drag frame and kills performance.
          border: "2px solid #2563eb",
          background: "rgba(37, 99, 235, 0.18)",
          borderRadius: 4,
          zIndex: 2,
        }}
        data-testid="zoom-selection-rect"
      />
      <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 bg-foreground text-background text-xs px-3 py-1.5 rounded-full shadow-lg font-medium">
        Drag to draw a box — release to zoom
      </div>
    </div>
  );
}
const ZoomSelectionOverlay = memo(ZoomSelectionOverlayImpl);

/**
 * Memoized node card. Only re-renders when its inputs actually change,
 * not when the parent pans/zooms. This is the single biggest perf win
 * for large sitemaps because the card tree contains hundreds of <img> tags.
 */
interface NodeCardProps {
  node: TreeNode;
  jobId: string;
  selected: boolean;
  onSelect: (node: PageNode) => void;
}
function NodeCardImpl({ node, jobId, selected, onSelect }: NodeCardProps) {
  const isError = node.statusCode >= 400 || node.statusCode === 0;
  const fileIcon =
    node.fileType === "html" ? (
      <Globe className="w-3 h-3" />
    ) : node.fileType === "pdf" ? (
      <FileText className="w-3 h-3" />
    ) : node.fileType === "image" ? (
      <FileImage className="w-3 h-3" />
    ) : (
      <File className="w-3 h-3" />
    );
  return (
    <div
      className={`sitemap-node absolute cursor-pointer rounded-lg border-2 bg-card shadow-sm overflow-hidden ${
        isError
          ? "border-red-500 ring-2 ring-red-500/20"
          : selected
          ? "border-primary ring-2 ring-primary/20"
          : "border-border/60 hover:border-primary/40"
      }`}
      style={{
        left: node.x,
        top: node.y,
        width: NODE_W,
        height: NODE_H,
        contain: "layout paint style",
      }}
      onClick={() => onSelect(node)}
      data-testid={`node-${node.id}`}
    >
      <div className="w-full h-[152px] bg-muted/50 relative overflow-hidden">
        {node.hasScreenshot ? (
          <img
            src={screenshotUrl(jobId, node.id, true)}
            alt={node.title}
            className="w-full h-full object-cover object-top"
            style={{ imageRendering: "auto" }}
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <div className="text-muted-foreground/40">{fileIcon}</div>
          </div>
        )}
        {isError && (
          <div className="absolute inset-0 bg-red-500/15 flex items-center justify-center">
            <span className="text-red-600 text-xs font-bold bg-white/80 px-1.5 py-0.5 rounded">
              {node.statusCode || "ERR"}
            </span>
          </div>
        )}
        <div
          className={`absolute top-1.5 right-1.5 w-2 h-2 rounded-full ${
            node.statusCode >= 200 && node.statusCode < 300
              ? "bg-green-500"
              : node.statusCode >= 300 && node.statusCode < 400
              ? "bg-yellow-500"
              : "bg-red-500"
          }`}
        />
      </div>
      <div className="px-2.5 py-2">
        <p className="text-[11px] font-medium leading-tight truncate" title={node.title}>
          {node.title || node.path}
        </p>
        <p className="text-[10px] text-muted-foreground truncate" title={node.path}>
          {node.path}
        </p>
      </div>
    </div>
  );
}
const NodeCard = memo(NodeCardImpl);

interface SitemapCanvasProps {
  treeNodes: TreeNode[];
  roots: TreeNode[];
  layoutWidth: number;
  layoutHeight: number;
  zoom: number;
  setZoom: (fn: (z: number) => number) => void;
  jobId: string;
  onSelectNode: (node: PageNode) => void;
  selectedNodeId: string | null;
  centerOffset?: { x: number; y: number } | null;
  onCenterOffsetConsumed?: () => void;
  zoomMode?: boolean;
  onZoomToRect?: (rect: { x: number; y: number; w: number; h: number }) => void;
  /** When true, bypass viewport culling and render every node (used for PNG/JPG export). */
  renderAllNodes?: boolean;
}

function SitemapCanvasImpl({
  treeNodes,
  roots,
  layoutWidth,
  layoutHeight,
  zoom,
  setZoom,
  jobId,
  onSelectNode,
  selectedNodeId,
  centerOffset,
  onCenterOffsetConsumed,
  zoomMode = false,
  onZoomToRect,
  renderAllNodes = false,
}: SitemapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const transformRef = useRef<HTMLDivElement>(null);
  // Pan offset is held in a ref + applied imperatively so dragging the canvas
  // doesn't trigger React re-renders of the (expensive) node tree.
  const panOffsetRef = useRef({ x: 30, y: 30 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0 });

  // Viewport culling state — only render cards visible on screen.
  // Tick increments whenever pan/zoom changes enough to warrant a recompute.
  const [viewportTick, setViewportTick] = useState(0);
  // Initialise with a sensible guess based on the current window so the first
  // render can cull correctly — otherwise we render up to 200 cards at (0,0)
  // before the ResizeObserver fires, which fires off hundreds of image
  // requests and causes the "screenshots load slowly" feel.
  const [containerSize, setContainerSize] = useState(() => {
    if (typeof window === "undefined") return { w: 1280, h: 720 };
    return { w: window.innerWidth, h: window.innerHeight };
  });

  const applyTransform = useCallback(() => {
    const el = transformRef.current;
    if (!el) return;
    el.style.transform = `translate3d(${panOffsetRef.current.x}px, ${panOffsetRef.current.y}px, 0) scale(${zoom})`;
  }, [zoom]);

  // Measure the container for viewport culling
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setContainerSize({ w: r.width, h: r.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Apply center offset from fit-view (imperatively, no re-render)
  useEffect(() => {
    if (centerOffset) {
      panOffsetRef.current = { x: centerOffset.x, y: centerOffset.y };
      applyTransform();
      setViewportTick((t) => t + 1); // trigger re-cull after fit-view
      onCenterOffsetConsumed?.();
    }
  }, [centerOffset, onCenterOffsetConsumed, applyTransform]);

  // Re-apply transform whenever zoom changes
  useEffect(() => {
    applyTransform();
    setViewportTick((t) => t + 1); // re-cull on zoom change
  }, [zoom, applyTransform]);

  const isPanningRef = useRef(false);
  const rafRef = useRef<number | null>(null);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      if (zoomMode) return; // selection overlay handles zoom-mode drags
      if ((e.target as HTMLElement).closest(".sitemap-node")) return;
      isPanningRef.current = true;
      setIsPanning(true);
      panStartRef.current = {
        x: e.clientX - panOffsetRef.current.x,
        y: e.clientY - panOffsetRef.current.y,
      };
    },
    [zoomMode]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isPanningRef.current) return;
      const clientX = e.clientX;
      const clientY = e.clientY;
      panOffsetRef.current = {
        x: clientX - panStartRef.current.x,
        y: clientY - panStartRef.current.y,
      };
      if (rafRef.current != null) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        applyTransform();
      });
    },
    [applyTransform]
  );

  const handleMouseUp = useCallback(() => {
    if (isPanningRef.current) {
      isPanningRef.current = false;
      setIsPanning(false);
      // Re-cull visible cards after a pan ends
      setViewportTick((t) => t + 1);
    }
  }, []);

  // Handler invoked by the selection overlay when user releases the mouse.
  const handleSelectionComplete = useCallback(
    (rectClient: { x: number; y: number; w: number; h: number }) => {
      if (!onZoomToRect) return;
      const pan = panOffsetRef.current;
      const canvasX = (rectClient.x - pan.x) / zoom;
      const canvasY = (rectClient.y - pan.y) / zoom;
      const canvasW = rectClient.w / zoom;
      const canvasH = rectClient.h / zoom;
      onZoomToRect({ x: canvasX, y: canvasY, w: canvasW, h: canvasH });
    },
    [zoom, onZoomToRect]
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.08 : 0.08;
      setZoom((z: number) => Math.min(Math.max(z + delta, 0.1), 3));
    },
    [setZoom]
  );

  // Memoize connector paths — only recompute when the tree itself changes.
  // (Connectors are cheap SVG paths; drawing all of them is fine.)
  const connectors = useMemo(() => {
    const out: JSX.Element[] = [];
    for (const node of treeNodes) {
      for (const child of node.children) {
        const x1 = node.x + NODE_W / 2;
        const y1 = node.y + NODE_H;
        const x2 = child.x + NODE_W / 2;
        const y2 = child.y;
        const midY = y1 + (y2 - y1) / 2;
        out.push(
          <path
            key={`${node.id}-${child.id}`}
            d={`M${x1},${y1} C${x1},${midY} ${x2},${midY} ${x2},${y2}`}
            stroke="hsl(var(--border))"
            strokeWidth={1.5}
            fill="none"
            opacity={0.7}
          />
        );
      }
    }
    return out;
  }, [treeNodes]);

  /**
   * Viewport culling — compute which cards are visible (or near-visible) in
   * the current viewport. Cards outside this window are NOT mounted, which
   * dramatically reduces DOM size + image fetches for large sitemaps.
   */
  const visibleNodes = useMemo(() => {
    // Export mode: render every card so the output is complete.
    if (renderAllNodes) return treeNodes;
    // If we haven't measured yet, render a reasonable initial subset so the
    // user sees something immediately rather than an empty canvas.
    if (containerSize.w === 0 || containerSize.h === 0) {
      // Very small safety fallback — should rarely fire now that we seed
      // containerSize from window dims.
      return treeNodes.slice(0, 30);
    }
    const pan = panOffsetRef.current;
    // Visible window in canvas (pre-transform) coordinates:
    // screenX = panX + canvasX * zoom  =>  canvasX = (screenX - panX) / zoom
    const bufferPx = 800; // generous buffer so panning rarely pops cards in/out
    const minX = (0 - pan.x) / zoom - bufferPx;
    const maxX = (containerSize.w - pan.x) / zoom + bufferPx;
    const minY = (0 - pan.y) / zoom - bufferPx;
    const maxY = (containerSize.h - pan.y) / zoom + bufferPx;
    const out: TreeNode[] = [];
    for (const node of treeNodes) {
      if (
        node.x + NODE_W >= minX &&
        node.x <= maxX &&
        node.y + NODE_H >= minY &&
        node.y <= maxY
      ) {
        out.push(node);
      }
    }
    // Safety cap: never render more than ~400 cards at once, even if the
    // viewport is enormous and fully zoomed out. Prefer the cards closest to
    // viewport center so the user always sees something.
    if (out.length > 400) {
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      out.sort((a, b) => {
        const da = (a.x - cx) ** 2 + (a.y - cy) ** 2;
        const db = (b.x - cx) ** 2 + (b.y - cy) ** 2;
        return da - db;
      });
      return out.slice(0, 400);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treeNodes, zoom, containerSize.w, containerSize.h, viewportTick, renderAllNodes]);

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-hidden sitemap-canvas bg-muted/20 relative"
      style={zoomMode ? { cursor: "crosshair" } : undefined}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
      data-testid="sitemap-canvas"
    >
      <div
        ref={transformRef}
        style={{
          transform: `translate3d(${panOffsetRef.current.x}px, ${panOffsetRef.current.y}px, 0) scale(${zoom})`,
          transformOrigin: "0 0",
          width: layoutWidth + 60,
          height: layoutHeight + 60,
          position: "relative",
          willChange: isPanning ? "transform" : "auto",
        }}
      >
        {/* SVG layer for connectors */}
        <svg
          width={layoutWidth + 60}
          height={layoutHeight + 60}
          className="absolute inset-0 pointer-events-none"
        >
          {connectors}
        </svg>

        {/* Node cards — viewport-culled + memoized for large sitemaps */}
        {visibleNodes.map((node) => (
          <NodeCard
            key={node.id}
            node={node}
            jobId={jobId}
            selected={selectedNodeId === node.id}
            onSelect={onSelectNode}
          />
        ))}
      </div>

      {/* Zoom-to-area overlay — isolated so dragging doesn't re-render the canvas */}
      {zoomMode && (
        <ZoomSelectionOverlay
          containerRef={containerRef}
          onComplete={handleSelectionComplete}
        />
      )}
    </div>
  );
}
export const SitemapCanvas = memo(SitemapCanvasImpl);
