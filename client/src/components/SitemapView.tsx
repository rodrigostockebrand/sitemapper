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
} from "lucide-react";

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
const NODE_W = 170;
const NODE_H = 150;
const MAX_COLS = 8; // Max children per row before wrapping

/**
 * Tree layout that respects actual subtree widths to prevent overlaps.
 * 
 * Each node is allocated enough horizontal space for its entire subtree.
 * Children are arranged in rows (max MAX_COLS per row), where each column
 * width is the max subtree width of any child in that column across all rows.
 */
function layoutTree(roots: TreeNode[], spacing: number = 0.5): { nodes: TreeNode[]; width: number; height: number } {
  // spacing: 0 = very tight, 1 = very spread out
  const H_GAP = Math.round(8 + spacing * 40); // 8..48
  const V_GAP = Math.round(15 + spacing * 55); // 15..70
  const allNodes: TreeNode[] = [];
  let maxX = 0;
  let maxY = 0;

  /**
   * Calculate the full width a subtree needs (recursive).
   * Memoized via a Map to avoid exponential recalc.
   */
  const widthCache = new Map<string, number>();
  function subtreeWidth(node: TreeNode): number {
    if (widthCache.has(node.id)) return widthCache.get(node.id)!;
    if (node.children.length === 0) {
      widthCache.set(node.id, NODE_W);
      return NODE_W;
    }
    const cols = Math.min(node.children.length, MAX_COLS);
    const rowCount = Math.ceil(node.children.length / cols);

    // Compute max subtree width per column across all rows
    const colWidths = new Array(cols).fill(NODE_W);
    for (let r = 0; r < rowCount; r++) {
      const startIdx = r * cols;
      const endIdx = Math.min(startIdx + cols, node.children.length);
      for (let i = startIdx; i < endIdx; i++) {
        const colIdx = i - startIdx;
        colWidths[colIdx] = Math.max(colWidths[colIdx], subtreeWidth(node.children[i]));
      }
    }

    const totalW = colWidths.reduce((sum, w) => sum + w, 0) + (cols - 1) * H_GAP;
    const result = Math.max(NODE_W, totalW);
    widthCache.set(node.id, result);
    return result;
  }

  /**
   * Calculate the full height a subtree needs (recursive).
   */
  const heightCache = new Map<string, number>();
  function subtreeHeight(node: TreeNode): number {
    if (heightCache.has(node.id)) return heightCache.get(node.id)!;
    if (node.children.length === 0) {
      heightCache.set(node.id, NODE_H);
      return NODE_H;
    }
    const cols = Math.min(node.children.length, MAX_COLS);
    const rowCount = Math.ceil(node.children.length / cols);

    let totalH = NODE_H + V_GAP;
    for (let r = 0; r < rowCount; r++) {
      const startIdx = r * cols;
      const endIdx = Math.min(startIdx + cols, node.children.length);
      let maxRowH = 0;
      for (let i = startIdx; i < endIdx; i++) {
        maxRowH = Math.max(maxRowH, subtreeHeight(node.children[i]));
      }
      totalH += maxRowH + (r < rowCount - 1 ? V_GAP : 0);
    }

    heightCache.set(node.id, totalH);
    return totalH;
  }

  /**
   * Position a node and recursively position its children.
   * Each child gets allocated its actual subtree width.
   */
  function position(node: TreeNode, x: number, y: number) {
    const w = subtreeWidth(node);

    // Center this node card above its children
    node.x = x + w / 2 - NODE_W / 2;
    node.y = y;
    allNodes.push(node);

    if (node.x + NODE_W > maxX) maxX = node.x + NODE_W;
    if (node.y + NODE_H > maxY) maxY = node.y + NODE_H;

    if (node.children.length === 0) return;

    const cols = Math.min(node.children.length, MAX_COLS);
    const rowCount = Math.ceil(node.children.length / cols);

    // Compute column widths (max subtree width per column across all rows)
    const colWidths = new Array(cols).fill(NODE_W);
    for (let r = 0; r < rowCount; r++) {
      const startIdx = r * cols;
      const endIdx = Math.min(startIdx + cols, node.children.length);
      for (let i = startIdx; i < endIdx; i++) {
        const colIdx = i - startIdx;
        colWidths[colIdx] = Math.max(colWidths[colIdx], subtreeWidth(node.children[i]));
      }
    }

    const totalGridW = colWidths.reduce((sum, cw) => sum + cw, 0) + (cols - 1) * H_GAP;
    const gridStartX = x + (w - totalGridW) / 2;

    let currentY = y + NODE_H + V_GAP;

    for (let r = 0; r < rowCount; r++) {
      const startIdx = r * cols;
      const endIdx = Math.min(startIdx + cols, node.children.length);

      let colX = gridStartX;
      let maxRowH = 0;

      for (let i = startIdx; i < endIdx; i++) {
        const colIdx = i - startIdx;
        const allocatedW = colWidths[colIdx];
        position(node.children[i], colX, currentY);
        colX += allocatedW + H_GAP;
        maxRowH = Math.max(maxRowH, subtreeHeight(node.children[i]));
      }

      currentY += maxRowH + V_GAP;
    }
  }

  let startX = 0;
  for (const root of roots) {
    position(root, startX, 0);
    startX += subtreeWidth(root) + H_GAP * 3;
  }

  return { nodes: allNodes, width: maxX + 60, height: maxY + 60 };
}

export function SitemapView({ job }: SitemapViewProps) {
  const [selectedNode, setSelectedNode] = useState<PageNode | null>(null);
  const [zoom, setZoom] = useState(0.65);
  const [viewMode, setViewMode] = useState<"tree" | "list">("tree");
  const [centerOffset, setCenterOffset] = useState<{ x: number; y: number } | null>(null);

  const [spacing, setSpacing] = useState(0.25);

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
  }, [layoutWidth, layoutHeight, selectedNode]);

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
          <Button variant="ghost" size="sm" className="h-8 text-xs gap-1.5" onClick={handleExportSVG} data-testid="button-export">
            <Download className="w-3.5 h-3.5" />
            Export SVG
          </Button>
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
            setZoom={setZoom}
            jobId={job.id}
            onSelectNode={setSelectedNode}
            selectedNodeId={selectedNode?.id || null}
            centerOffset={centerOffset}
            onCenterOffsetConsumed={() => setCenterOffset(null)}
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
