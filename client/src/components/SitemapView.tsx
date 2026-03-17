import { useState, useMemo, useCallback } from "react";
import type { CrawlJob, PageNode } from "@shared/schema";
import { SitemapCanvas } from "@/components/SitemapCanvas";
import { PageDetailPanel } from "@/components/PageDetailPanel";
import { SitemapStats } from "@/components/SitemapStats";
import { screenshotUrl } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  LayoutGrid,
  List,
  Download,
  ZoomIn,
  ZoomOut,
  Maximize2,
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
const H_GAP = 20;
const V_GAP = 50;
const MAX_COLS = 6; // Max children per row before wrapping

/**
 * Compact tree layout using a fixed-width grid for children.
 * 
 * Key insight: when a node has many children, we DON'T let each child's
 * subtree width dictate the column width. Instead, we allocate a fixed
 * column width for each child (NODE_W + H_GAP) and let the subtree
 * overflow downward. This prevents the exponential width explosion that
 * happens with recursive subtree width calculations.
 * 
 * Children with their own deep subtrees get their subtree laid out below
 * them in a compact nested grid.
 */
function layoutTree(roots: TreeNode[]): { nodes: TreeNode[]; width: number; height: number } {
  const allNodes: TreeNode[] = [];
  let maxX = 0;
  let maxY = 0;

  const CELL_W = NODE_W + H_GAP; // Fixed column width per child
  
  /**
   * Calculate the height needed for a subtree when constrained to
   * a fixed column width.
   */
  function subtreeHeight(node: TreeNode): number {
    if (node.children.length === 0) return NODE_H;
    
    const cols = Math.min(node.children.length, MAX_COLS);
    const rowCount = Math.ceil(node.children.length / cols);
    
    let totalH = NODE_H + V_GAP; // This node + gap

    for (let r = 0; r < rowCount; r++) {
      const startIdx = r * cols;
      const endIdx = Math.min(startIdx + cols, node.children.length);
      let maxRowH = 0;
      for (let i = startIdx; i < endIdx; i++) {
        maxRowH = Math.max(maxRowH, subtreeHeight(node.children[i]));
      }
      totalH += maxRowH + (r < rowCount - 1 ? V_GAP : 0);
    }

    return totalH;
  }

  /**
   * Calculate the width needed for a subtree.
   */
  function subtreeWidth(node: TreeNode): number {
    if (node.children.length === 0) return NODE_W;
    const cols = Math.min(node.children.length, MAX_COLS);
    return Math.max(NODE_W, cols * CELL_W - H_GAP);
  }

  /**
   * Position a node and recursively position its children in a grid.
   */
  function position(node: TreeNode, x: number, y: number) {
    const w = subtreeWidth(node);

    // Center the node card above its children grid
    node.x = x + w / 2 - NODE_W / 2;
    node.y = y;
    allNodes.push(node);

    if (node.x + NODE_W > maxX) maxX = node.x + NODE_W;
    if (node.y + NODE_H > maxY) maxY = node.y + NODE_H;

    if (node.children.length === 0) return;

    const cols = Math.min(node.children.length, MAX_COLS);
    const rowCount = Math.ceil(node.children.length / cols);
    const gridW = cols * CELL_W - H_GAP;

    let currentY = y + NODE_H + V_GAP;

    for (let r = 0; r < rowCount; r++) {
      const startIdx = r * cols;
      const endIdx = Math.min(startIdx + cols, node.children.length);
      const rowLen = endIdx - startIdx;
      
      // Center the row if it has fewer than cols items
      const rowW = rowLen * CELL_W - H_GAP;
      const rowStartX = x + (gridW - rowW) / 2;

      let maxRowH = 0;

      for (let i = startIdx; i < endIdx; i++) {
        const colIdx = i - startIdx;
        const childX = rowStartX + colIdx * CELL_W;
        position(node.children[i], childX, currentY);
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

  const { treeNodes, layoutWidth, layoutHeight, roots } = useMemo(() => {
    const roots = buildTree(job.pages);
    const { nodes, width, height } = layoutTree(roots);
    return { treeNodes: nodes, layoutWidth: width, layoutHeight: height, roots };
  }, [job.pages]);

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
    setZoom(Math.min(scaleX, scaleY, 1));
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
