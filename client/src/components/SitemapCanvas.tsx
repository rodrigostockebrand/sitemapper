import { useRef, useState, useCallback, useEffect } from "react";
import type { TreeNode } from "@/components/SitemapView";
import type { PageNode } from "@shared/schema";
import { screenshotUrl } from "@/lib/api";
import { FileText, FileImage, File, Globe } from "lucide-react";

const NODE_W = 240;
const NODE_H = 200;

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
}

export function SitemapCanvas({
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
}: SitemapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [panOffset, setPanOffset] = useState({ x: 30, y: 30 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  // Apply center offset from fit-view
  useEffect(() => {
    if (centerOffset) {
      setPanOffset({ x: centerOffset.x, y: centerOffset.y });
      onCenterOffsetConsumed?.();
    }
  }, [centerOffset, onCenterOffsetConsumed]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest(".sitemap-node")) return;
      setIsPanning(true);
      setPanStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
    },
    [panOffset]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isPanning) return;
      setPanOffset({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y,
      });
    },
    [isPanning, panStart]
  );

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.08 : 0.08;
      setZoom((z: number) => Math.min(Math.max(z + delta, 0.1), 3));
    },
    [setZoom]
  );

  // Generate connector paths between parent and children
  const connectors = [];
  for (const node of treeNodes) {
    for (const child of node.children) {
      const x1 = node.x + NODE_W / 2;
      const y1 = node.y + NODE_H;
      const x2 = child.x + NODE_W / 2;
      const y2 = child.y;
      const midY = y1 + (y2 - y1) / 2;
      connectors.push(
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

  const getFileIcon = (fileType: string) => {
    switch (fileType) {
      case "html":
        return <Globe className="w-3 h-3" />;
      case "pdf":
        return <FileText className="w-3 h-3" />;
      case "image":
        return <FileImage className="w-3 h-3" />;
      default:
        return <File className="w-3 h-3" />;
    }
  };

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-hidden sitemap-canvas bg-muted/20"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
      data-testid="sitemap-canvas"
    >
      <div
        style={{
          transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom})`,
          transformOrigin: "0 0",
          width: layoutWidth + 60,
          height: layoutHeight + 60,
          position: "relative",
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

        {/* Node cards */}
        {treeNodes.map((node) => (
          <div
            key={node.id}
            className={`sitemap-node absolute cursor-pointer rounded-lg border-2 bg-card shadow-sm overflow-hidden ${
              node.statusCode >= 400 || node.statusCode === 0
                ? "border-red-500 ring-2 ring-red-500/20"
                : selectedNodeId === node.id
                ? "border-primary ring-2 ring-primary/20"
                : "border-border/60 hover:border-primary/40"
            }`}
            style={{
              left: node.x,
              top: node.y,
              width: NODE_W,
              height: NODE_H,
            }}
            onClick={() => onSelectNode(node)}
            data-testid={`node-${node.id}`}
          >
            {/* Screenshot thumbnail */}
            <div className="w-full h-[152px] bg-muted/50 relative overflow-hidden">
              {node.hasScreenshot ? (
                <img
                  src={screenshotUrl(jobId, node.id)}
                  alt={node.title}
                  className="w-full h-full object-cover object-top"
                  style={{ imageRendering: "auto" }}
                  loading="lazy"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <div className="text-muted-foreground/40">
                    {getFileIcon(node.fileType)}
                  </div>
                </div>
              )}
              {/* Red overlay for error pages */}
              {(node.statusCode >= 400 || node.statusCode === 0) && (
                <div className="absolute inset-0 bg-red-500/15 flex items-center justify-center">
                  <span className="text-red-600 text-xs font-bold bg-white/80 px-1.5 py-0.5 rounded">
                    {node.statusCode || "ERR"}
                  </span>
                </div>
              )}
              {/* Status badge */}
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
            {/* Label */}
            <div className="px-2.5 py-2">
              <p className="text-[11px] font-medium leading-tight truncate" title={node.title}>
                {node.title || node.path}
              </p>
              <p className="text-[10px] text-muted-foreground truncate" title={node.path}>
                {node.path}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
