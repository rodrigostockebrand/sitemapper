import type { PageNode } from "@shared/schema";
import { screenshotUrl } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  X,
  ExternalLink,
  FileType,
  Hash,
  Link2,
  Globe,
  FileText,
  Type,
  AlignLeft,
} from "lucide-react";

interface PageDetailPanelProps {
  node: PageNode;
  jobId: string;
  onClose: () => void;
}

export function PageDetailPanel({ node, jobId, onClose }: PageDetailPanelProps) {
  return (
    <div className="w-[380px] border-l border-border bg-card flex flex-col" data-testid="detail-panel">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="text-sm font-semibold truncate pr-2">Page Details</h3>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 flex-shrink-0"
          onClick={onClose}
          data-testid="button-close-detail"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-5">
          {/* Screenshot */}
          {node.hasScreenshot && (
            <div className="rounded-lg overflow-hidden border border-border">
              <img
                src={screenshotUrl(jobId, node.id)}
                alt={node.title}
                className="w-full"
                data-testid="img-screenshot"
              />
            </div>
          )}

          {/* Title */}
          <div>
            <h4 className="text-base font-semibold leading-snug" data-testid="text-page-title">
              {node.title}
            </h4>
            <a
              href={node.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary hover:underline flex items-center gap-1 mt-1"
              data-testid="link-page-url"
            >
              {node.url}
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          {/* Status badges */}
          <div className="flex flex-wrap gap-1.5">
            <Badge
              variant={
                node.statusCode >= 200 && node.statusCode < 300
                  ? "secondary"
                  : "destructive"
              }
              className="text-[10px]"
            >
              {node.statusCode || "Error"}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {node.fileType.toUpperCase()}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              Depth {node.depth}
            </Badge>
          </div>

          {/* Meta info grid */}
          <div className="space-y-3">
            {node.h1 && (
              <InfoRow icon={<Type className="w-3.5 h-3.5" />} label="H1" value={node.h1} />
            )}
            {node.metaDescription && (
              <InfoRow
                icon={<AlignLeft className="w-3.5 h-3.5" />}
                label="Description"
                value={node.metaDescription}
              />
            )}
            <InfoRow
              icon={<FileType className="w-3.5 h-3.5" />}
              label="Content Type"
              value={node.contentType}
            />
            <InfoRow
              icon={<Hash className="w-3.5 h-3.5" />}
              label="Word Count"
              value={node.wordCount.toLocaleString()}
            />
            <InfoRow
              icon={<Link2 className="w-3.5 h-3.5" />}
              label="Internal Links"
              value={String(node.internalLinks)}
            />
            <InfoRow
              icon={<Globe className="w-3.5 h-3.5" />}
              label="External Links"
              value={String(node.externalLinks)}
            />
            <InfoRow
              icon={<FileText className="w-3.5 h-3.5" />}
              label="Path"
              value={node.path}
            />
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <div className="text-muted-foreground mt-0.5 flex-shrink-0">{icon}</div>
      <div className="min-w-0">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
          {label}
        </p>
        <p className="text-xs leading-relaxed break-words">{value}</p>
      </div>
    </div>
  );
}
