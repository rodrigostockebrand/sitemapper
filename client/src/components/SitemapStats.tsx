import type { CrawlJob } from "@shared/schema";
import { Badge } from "@/components/ui/badge";
import { Globe, FileText, Camera, AlertTriangle } from "lucide-react";

interface SitemapStatsProps {
  job: CrawlJob;
}

export function SitemapStats({ job }: SitemapStatsProps) {
  const totalPages = job.pages.length;
  const htmlPages = job.pages.filter((p) => p.fileType === "html").length;
  const pdfPages = job.pages.filter((p) => p.fileType === "pdf").length;
  const screenshotCount = job.pages.filter((p) => p.hasScreenshot).length;
  const errorPages = job.pages.filter(
    (p) => p.statusCode < 200 || p.statusCode >= 400
  ).length;

  return (
    <div className="flex items-center gap-2 text-xs" data-testid="stats-bar">
      <Badge variant="outline" className="gap-1 text-[10px] font-mono">
        <Globe className="w-3 h-3" />
        {job.domain}
      </Badge>
      <span className="text-muted-foreground">
        {totalPages} pages
      </span>
      <span className="text-muted-foreground/40">·</span>
      <span className="text-muted-foreground">
        {htmlPages} HTML
      </span>
      {pdfPages > 0 && (
        <>
          <span className="text-muted-foreground/40">·</span>
          <span className="text-muted-foreground flex items-center gap-1">
            <FileText className="w-3 h-3" />
            {pdfPages} PDF
          </span>
        </>
      )}
      <span className="text-muted-foreground/40">·</span>
      <span className="text-muted-foreground flex items-center gap-1">
        <Camera className="w-3 h-3" />
        {screenshotCount} screenshots
      </span>
      {errorPages > 0 && (
        <>
          <span className="text-muted-foreground/40">·</span>
          <span className="text-yellow-600 dark:text-yellow-500 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            {errorPages} errors
          </span>
        </>
      )}
    </div>
  );
}
