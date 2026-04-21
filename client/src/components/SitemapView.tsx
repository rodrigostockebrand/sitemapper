import { useState, useMemo, useCallback } from "react";
import type { CrawlJob, PageNode } from "@shared/schema";
import { SitemapCanvas } from "@/components/SitemapCanvas";
import { PageDetailPanel } from "@/components/PageDetailPanel";
import { SitemapStats } from "@/components/SitemapStats";
import { screenshotUrl } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import {
  LayoutGrid,
  List,
  Download,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  ScanSearch,
  X,
  Sparkles,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toPng, toJpeg } from "html-to-image";
import { useToast } from "@/hooks/use-toast";

interface SitemapViewProps {
  job: CrawlJob;
}

export interface TreeNode extends PageNode {
  children: TreeNode[];
  x: number;
  y: number;
}

function buildTree(pages: PageNode[]): TreeNode[] {
  const nodeMap = new Map<string, TreeNode>();

  for (const page of pages) {
    nodeMap.set(page.id, { ...page, children: [], x: 0, y: 0 });
  }

  const roots: TreeNode[] = [];

  for (const page of pages) {
    const node = nodeMap.get(page.id)!;
    if (page.parentId && nodeMap.has(page.parentId)) {
      nodeMap.get(page.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

// Layout constants
const NODE_W = 240;
const NODE_H = 200;
const MAX_COLS = 10; // Max children per row before wrapping

/**
 * Compact tree layout that minimises wasted space.
 *
 * The key insight: instead of reserving the full recursive subtree width
 * for every column, we use a two-pass approach:
 *   1. Measure each subtree's width (recursive, memoised).
 *   2. Position nodes, but blend between "subtree-reserved" width and
 *      a tighter "node-only" width based on the spacing slider.
 *
 * spacing=0 → columns are just NODE_W + gap (very tight, deepest nodes may
 *             overlap slightly but siblings never do).
 * spacing=1 → classic full-subtree-width allocation.
 * Default 0.3 gives a good balance.
 */
function layoutTree(
  roots: TreeNode[],
  spacing: number = 0.3,
): { nodes: TreeNode[]; width: number; height: number } {
  // Gap ranges controlled by the slider
  const H_GAP = Math.round(6 + spacing * 30);  // 6..36
  const V_GAP = Math.round(12 + spacing * 40);  // 12..52

  const allNodes: TreeNode[] = [];
  let maxX = 0;
  let maxY = 0;

  /* ── Measure pass ─────────────────────────────────────── */

  const widthCache = new Map<string, number>();
  function subtreeWidth(node: TreeNode): number {
    if (widthCache.has(node.id)) return widthCache.get(node.id)!;
    if (node.children.length === 0) {
      widthCache.set(node.id, NODE_W);
      return NODE_W;
    }
    const cols = Math.min(node.children.length, MAX_COLS);
    const rowCount = Math.ceil(node.children.length / cols);
    const colWidths = new Array(cols).fill(NODE_W);
    for (let r = 0; r < rowCount; r++) {
      for (let i = r * cols; i < Math.min((r + 1) * cols, node.children.length); i++) {
        const c = i - r * cols;
        colWidths[c] = Math.max(colWidths[c], subtreeWidth(node.children[i]));
      }
    }
    const full = colWidths.reduce((s, w) => s + w, 0) + (cols - 1) * H_GAP;
    widthCache.set(node.id, Math.max(NODE_W, full));
    return widthCache.get(node.id)!;
  }

  const heightCache = new Map<string, number>();
  function subtreeHeight(node: TreeNode): number {
    if (heightCache.has(node.id)) return heightCache.get(node.id)!;
    if (node.children.length === 0) {
      heightCache.set(node.id, NODE_H);
      return NODE_H;
    }
    const cols = Math.min(node.children.length, MAX_COLS);
    const rowCount = Math.ceil(node.children.length / cols);
    let h = NODE_H + V_GAP;
    for (let r = 0; r < rowCount; r++) {
      let rowMax = 0;
      for (let i = r * cols; i < Math.min((r + 1) * cols, node.children.length); i++) {
        rowMax = Math.max(rowMax, subtreeHeight(node.children[i]));
      }
      h += rowMax + (r < rowCount - 1 ? V_GAP : 0);
    }
    heightCache.set(node.id, h);
    return h;
  }

  /* ── Position pass ────────────────────────────────────── */

  /**
   * Effective width for a child column — blend between full subtree width
   * and just NODE_W based on the spacing slider.
   */
  function effectiveColWidth(fullW: number): number {
    return Math.round(NODE_W + spacing * (fullW - NODE_W));
  }

  function position(node: TreeNode, x: number, allocatedW: number, y: number) {
    // Centre this node within its allocated strip
    node.x = x + allocatedW / 2 - NODE_W / 2;
    node.y = y;
    allNodes.push(node);
    maxX = Math.max(maxX, node.x + NODE_W);
    maxY = Math.max(maxY, node.y + NODE_H);

    if (node.children.length === 0) return;

    const cols = Math.min(node.children.length, MAX_COLS);
    const rowCount = Math.ceil(node.children.length / cols);

    // Compute effective column widths
    const colFullWidths = new Array(cols).fill(NODE_W);
    for (let r = 0; r < rowCount; r++) {
      for (let i = r * cols; i < Math.min((r + 1) * cols, node.children.length); i++) {
        const c = i - r * cols;
        colFullWidths[c] = Math.max(colFullWidths[c], subtreeWidth(node.children[i]));
      }
    }
    const colWidths = colFullWidths.map(effectiveColWidth);
    const gridW = colWidths.reduce((s, w) => s + w, 0) + (cols - 1) * H_GAP;
    const gridStartX = x + (allocatedW - gridW) / 2;

    let curY = y + NODE_H + V_GAP;
    for (let r = 0; r < rowCount; r++) {
      let cx = gridStartX;
      let rowMaxH = 0;
      for (let i = r * cols; i < Math.min((r + 1) * cols, node.children.length); i++) {
        const c = i - r * cols;
        position(node.children[i], cx, colWidths[c], curY);
        cx += colWidths[c] + H_GAP;
        rowMaxH = Math.max(rowMaxH, subtreeHeight(node.children[i]));
      }
      curY += rowMaxH + V_GAP;
    }
  }

  let startX = 0;
  for (const root of roots) {
    const w = effectiveColWidth(subtreeWidth(root));
    position(root, startX, w, 0);
    startX += w + H_GAP * 2;
  }

  return { nodes: allNodes, width: maxX + 60, height: maxY + 60 };
}

export function SitemapView({ job }: SitemapViewProps) {
  const { user } = useAuth();
  const isPro = user?.tier === "pro";
  const { toast } = useToast();
  const [isExporting, setIsExporting] = useState(false);

  const [selectedNode, setSelectedNode] = useState<PageNode | null>(null);
  const [zoom, setZoom] = useState(0.5);
  const [viewMode, setViewMode] = useState<"tree" | "list">("tree");
  const [centerOffset, setCenterOffset] = useState<{ x: number; y: number } | null>(null);

  const [spacing, setSpacing] = useState(0.3);

  // Zoom-to-area state
  const [zoomMode, setZoomMode] = useState(false);
  const [isZoomedIn, setIsZoomedIn] = useState(false);

  const { treeNodes, layoutWidth, layoutHeight, roots } = useMemo(() => {
    const roots = buildTree(job.pages);
    const { nodes, width, height } = layoutTree(roots, spacing);
    return { treeNodes: nodes, layoutWidth: width, layoutHeight: height, roots };
  }, [job.pages, spacing]);

  const handleZoomIn = useCallback(() => {
    setZoom((z) => Math.min(z + 0.15, 2));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom((z) => Math.max(z - 0.15, 0.15));
  }, []);

  const handleFitView = useCallback(() => {
    const containerWidth = window.innerWidth - (selectedNode ? 400 : 0);
    const containerHeight = window.innerHeight - 140;
    const scaleX = containerWidth / (layoutWidth + 60);
    const scaleY = containerHeight / (layoutHeight + 60);
    const newZoom = Math.min(scaleX, scaleY, 1);
    setZoom(newZoom);
    // Center the map in the viewport
    const scaledW = (layoutWidth + 60) * newZoom;
    const scaledH = (layoutHeight + 60) * newZoom;
    const cx = Math.max(0, (containerWidth - scaledW) / 2);
    const cy = Math.max(0, (containerHeight - scaledH) / 2);
    setCenterOffset({ x: cx, y: cy });
    setIsZoomedIn(false);
  }, [layoutWidth, layoutHeight, selectedNode]);

  const handleZoomToRect = useCallback(
    (rect: { x: number; y: number; w: number; h: number }) => {
      const containerWidth = window.innerWidth - (selectedNode ? 400 : 0);
      const containerHeight = window.innerHeight - 140;
      // Compute zoom needed to fit the selected rect into the viewport
      const padding = 40; // px of breathing room around the zoomed area
      const scaleX = (containerWidth - padding * 2) / Math.max(rect.w, 1);
      const scaleY = (containerHeight - padding * 2) / Math.max(rect.h, 1);
      const newZoom = Math.min(Math.max(Math.min(scaleX, scaleY), 0.1), 3);
      setZoom(newZoom);
      // Center the rect within the viewport
      const cx = (containerWidth - rect.w * newZoom) / 2 - rect.x * newZoom;
      const cy = (containerHeight - rect.h * newZoom) / 2 - rect.y * newZoom;
      setCenterOffset({ x: cx, y: cy });
      setZoomMode(false);
      setIsZoomedIn(true);
    },
    [selectedNode]
  );

  const handleExitZoom = useCallback(() => {
    handleFitView();
  }, [handleFitView]);

  const handleExportSVG = useCallback(() => {
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${layoutWidth + 60}" height="${layoutHeight + 60}" viewBox="0 0 ${layoutWidth + 60} ${layoutHeight + 60}">`;
    svg += `<rect width="100%" height="100%" fill="#f8f9fb"/>`;
    svg += `<style>text { font-family: Inter, sans-serif; font-size: 11px; fill: #1a1a2e; }</style>`;

    for (const node of treeNodes) {
      for (const child of node.children) {
        const x1 = node.x + NODE_W / 2 + 30;
        const y1 = node.y + NODE_H + 30;
        const x2 = child.x + NODE_W / 2 + 30;
        const y2 = child.y + 30;
        const midY = y1 + (y2 - y1) / 2;
        svg += `<path d="M${x1},${y1} C${x1},${midY} ${x2},${midY} ${x2},${y2}" stroke="#c0c4cc" fill="none" stroke-width="1.5"/>`;
      }
    }

    for (const node of treeNodes) {
      const x = node.x + 30;
      const y = node.y + 30;
      svg += `<rect x="${x}" y="${y}" width="${NODE_W}" height="${NODE_H}" rx="8" fill="white" stroke="#dde1e8" stroke-width="1"/>`;
      const label = (node.title || node.path).substring(0, 22);
      svg += `<text x="${x + NODE_W / 2}" y="${y + NODE_H - 12}" text-anchor="middle" font-size="10">${label}</text>`;
    }

    svg += `</svg>`;

    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sitemap-${job.domain}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }, [treeNodes, layoutWidth, layoutHeight, job.domain]);

  /**
   * Export the CURRENT visible canvas view as PNG or JPG (Pro only).
   * Captures exactly what the user sees — including any zoom-to-area state.
   */
  const handleExportImage = useCallback(
    async (format: "png" | "jpg") => {
      if (!isPro) {
        toast({
          title: "Pro feature",
          description: "PNG and JPG exports are available on the Pro plan.",
        });
        return;
      }
      const canvas = document.querySelector(
        '[data-testid="sitemap-canvas"]'
      ) as HTMLElement | null;
      if (!canvas) {
        toast({ title: "Export failed", description: "Canvas not found." });
        return;
      }
      setIsExporting(true);
      try {
        // Pre-load every screenshot image in the canvas so off-screen (lazy)
        // images are fully fetched before we rasterize the DOM to a picture.
        toast({
          title: "Preparing export…",
          description: "Loading all screenshots. This may take a few seconds.",
        });
        const imgs = Array.from(canvas.querySelectorAll("img")) as HTMLImageElement[];
        await Promise.all(
          imgs.map((img) => {
            // Force eager loading for this export pass
            img.loading = "eager";
            if (img.complete && img.naturalWidth > 0) return Promise.resolve();
            return new Promise<void>((resolve) => {
              const done = () => resolve();
              img.addEventListener("load", done, { once: true });
              img.addEventListener("error", done, { once: true });
              // Safety timeout per-image so a single slow image doesn't stall export
              setTimeout(done, 8000);
            });
          })
        );
        // Give the browser a frame to paint freshly-loaded images
        await new Promise((r) => requestAnimationFrame(() => r(null)));

        const options = {
          pixelRatio: 2,
          cacheBust: false, // images are already loaded; cache-busting would refetch them
          backgroundColor: "#ffffff",
          // Skip the selection-overlay UI so the export looks clean.
          filter: (node: HTMLElement) => {
            if (!(node instanceof HTMLElement)) return true;
            const testId = node.getAttribute?.("data-testid");
            return testId !== "zoom-selection-overlay";
          },
        };
        const dataUrl =
          format === "png"
            ? await toPng(canvas, options)
            : await toJpeg(canvas, { ...options, quality: 0.95 });
        const a = document.createElement("a");
        const suffix = isZoomedIn ? "-zoomed" : "";
        a.href = dataUrl;
        a.download = `sitemap-${job.domain}${suffix}.${format}`;
        a.click();
        toast({
          title: "Export ready",
          description: `Saved ${isZoomedIn ? "zoomed view" : "full view"} as ${format.toUpperCase()}.`,
        });
      } catch (err) {
        console.error("Image export failed", err);
        toast({
          title: "Export failed",
          description: "Could not generate image. Try again.",
        });
      } finally {
        setIsExporting(false);
      }
    },
    [isPro, toast, job.domain, isZoomedIn]
  );

  return (
    <div className="flex flex-col h-[calc(100vh-57px)]">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card/50">
        <div className="flex items-center gap-3">
          <SitemapStats job={job} />
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex items-center border border-border rounded-md overflow-hidden mr-2">
            <button
              onClick={() => setViewMode("tree")}
              className={`p-1.5 transition-colors ${viewMode === "tree" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}
              data-testid="button-tree-view"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`p-1.5 transition-colors ${viewMode === "list" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}
              data-testid="button-list-view"
            >
              <List className="w-4 h-4" />
            </button>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleZoomOut} data-testid="button-zoom-out">
            <ZoomOut className="w-4 h-4" />
          </Button>
          <span className="text-xs text-muted-foreground font-mono w-10 text-center">
            {Math.round(zoom * 100)}%
          </span>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleZoomIn} data-testid="button-zoom-in">
            <ZoomIn className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleFitView} data-testid="button-fit">
            <Maximize2 className="w-4 h-4" />
          </Button>

          {/* Zoom-to-area (Pro) */}
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={zoomMode ? "default" : "ghost"}
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => isPro && setZoomMode((v) => !v)}
                  disabled={!isPro}
                  data-testid="button-zoom-to-area"
                >
                  <ScanSearch className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                {isPro ? (
                  zoomMode ? "Cancel zoom-to-area" : "Zoom to area — draw a box"
                ) : (
                  <span className="flex items-center gap-1">
                    <Sparkles className="w-3 h-3" /> Pro feature: zoom to area
                  </span>
                )}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {/* Exit zoom — shown when user is zoomed into a selection */}
          {isZoomedIn && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1.5"
              onClick={handleExitZoom}
              data-testid="button-exit-zoom"
            >
              <X className="w-3.5 h-3.5" />
              Exit zoom
            </Button>
          )}

          <div className="w-px h-5 bg-border mx-1" />
          <div className="flex items-center gap-1.5 mr-1" title="Map density">
            <Minimize2 className="w-3 h-3 text-muted-foreground" />
            <Slider
              value={[spacing]}
              onValueChange={([v]) => setSpacing(v)}
              min={0}
              max={1}
              step={0.05}
              className="w-20"
              data-testid="slider-spacing"
            />
            <Maximize2 className="w-3 h-3 text-muted-foreground" />
          </div>
          <div className="w-px h-5 bg-border mx-1" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs gap-1.5"
                disabled={isExporting}
                data-testid="button-export"
              >
                <Download className="w-3.5 h-3.5" />
                {isExporting ? "Exporting…" : "Export"}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="text-xs">
                {isZoomedIn ? "Export zoomed view" : "Export full map"}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleExportSVG} data-testid="export-svg">
                <Download className="w-3.5 h-3.5 mr-2" />
                SVG (vector)
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!isPro}
                onClick={() => handleExportImage("png")}
                data-testid="export-png"
                className="flex items-center justify-between"
              >
                <span className="flex items-center">
                  <Download className="w-3.5 h-3.5 mr-2" />
                  PNG (current view)
                </span>
                {!isPro && <Sparkles className="w-3 h-3 text-muted-foreground" />}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!isPro}
                onClick={() => handleExportImage("jpg")}
                data-testid="export-jpg"
                className="flex items-center justify-between"
              >
                <span className="flex items-center">
                  <Download className="w-3.5 h-3.5 mr-2" />
                  JPG (current view)
                </span>
                {!isPro && <Sparkles className="w-3 h-3 text-muted-foreground" />}
              </DropdownMenuItem>
              {!isPro && (
                <>
                  <DropdownMenuSeparator />
                  <div className="px-2 py-1.5 text-[11px] text-muted-foreground">
                    PNG & JPG exports are a Pro feature.
                  </div>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Content area */}
      <div className="flex flex-1 overflow-hidden">
        {viewMode === "tree" ? (
          <SitemapCanvas
            treeNodes={treeNodes}
            roots={roots}
            layoutWidth={layoutWidth}
            layoutHeight={layoutHeight}
            zoom={zoom}
            setZoom={(fn) => {
              setZoom(fn);
              // Manual zoom invalidates "zoomed-in" state so the X button disappears
              setIsZoomedIn(false);
            }}
            jobId={job.id}
            onSelectNode={setSelectedNode}
            selectedNodeId={selectedNode?.id || null}
            centerOffset={centerOffset}
            onCenterOffsetConsumed={() => setCenterOffset(null)}
            zoomMode={zoomMode}
            onZoomToRect={handleZoomToRect}
          />
        ) : (
          <PageListView
            pages={job.pages}
            jobId={job.id}
            onSelectNode={setSelectedNode}
            selectedNodeId={selectedNode?.id || null}
          />
        )}

        {/* Detail panel */}
        {selectedNode && (
          <PageDetailPanel
            node={selectedNode}
            jobId={job.id}
            onClose={() => setSelectedNode(null)}
          />
        )}
      </div>
    </div>
  );
}

// Simple list view
function PageListView({
  pages,
  jobId,
  onSelectNode,
  selectedNodeId,
}: {
  pages: PageNode[];
  jobId: string;
  onSelectNode: (node: PageNode) => void;
  selectedNodeId: string | null;
}) {
  return (
    <div className="flex-1 overflow-auto p-4">
      <div className="max-w-4xl mx-auto space-y-1">
        {pages.map((page) => (
          <button
            key={page.id}
            onClick={() => onSelectNode(page)}
            className={`w-full text-left px-3 py-2.5 rounded-lg flex items-center gap-3 transition-colors ${
              selectedNodeId === page.id
                ? "bg-primary/10 border border-primary/20"
                : "hover:bg-muted/50 border border-transparent"
            }`}
            data-testid={`list-item-${page.id}`}
          >
            <div className="w-20 h-14 rounded bg-muted flex-shrink-0 overflow-hidden">
              {page.hasScreenshot ? (
                <img
                  src={screenshotUrl(jobId, page.id)}
                  alt=""
                  className="w-full h-full object-cover object-top"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">
                  {page.fileType.toUpperCase()}
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{page.title}</p>
              <p className="text-xs text-muted-foreground truncate">{page.path}</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Badge variant={page.statusCode >= 200 && page.statusCode < 300 ? "secondary" : "destructive"} className="text-[10px]">
                {page.statusCode || "ERR"}
              </Badge>
              <span className="text-[10px] text-muted-foreground">
                Depth {page.depth}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
