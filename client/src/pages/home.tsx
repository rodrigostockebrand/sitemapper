import { useState } from "react";
import { CrawlForm } from "@/components/CrawlForm";
import { CrawlProgress } from "@/components/CrawlProgress";
import { SitemapView } from "@/components/SitemapView";
import { PerplexityAttribution } from "@/components/PerplexityAttribution";
import type { CrawlJob } from "@shared/schema";
import { Globe, Map } from "lucide-react";

export default function Home() {
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [jobData, setJobData] = useState<CrawlJob | null>(null);
  const [isComplete, setIsComplete] = useState(false);

  const handleCrawlStarted = (jobId: string) => {
    setCurrentJobId(jobId);
    setJobData(null);
    setIsComplete(false);
  };

  const handleCrawlComplete = (data: CrawlJob) => {
    setJobData(data);
    setIsComplete(true);
  };

  const handleReset = () => {
    setCurrentJobId(null);
    setJobData(null);
    setIsComplete(false);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-screen-xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Map className="w-4.5 h-4.5 text-primary" />
            </div>
            <span className="font-semibold text-sm tracking-tight">SiteMapper</span>
          </div>
          {isComplete && (
            <button
              onClick={handleReset}
              data-testid="button-new-crawl"
              className="text-sm text-primary hover:text-primary/80 font-medium transition-colors"
            >
              New Crawl
            </button>
          )}
        </div>
      </header>

      {/* Main content */}
      {!currentJobId && !isComplete && (
        <div className="max-w-screen-xl mx-auto px-4 py-16">
          <div className="max-w-xl mx-auto text-center mb-10">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-5">
              <Globe className="w-7 h-7 text-primary" />
            </div>
            <h1 className="text-xl font-bold tracking-tight mb-2">Visual Sitemap Generator</h1>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Enter a domain to crawl its pages, capture screenshots, and generate an interactive visual sitemap with hierarchy and page details.
            </p>
          </div>
          <CrawlForm onCrawlStarted={handleCrawlStarted} />
        </div>
      )}

      {currentJobId && !isComplete && (
        <CrawlProgress jobId={currentJobId} onComplete={handleCrawlComplete} />
      )}

      {isComplete && jobData && (
        <SitemapView job={jobData} />
      )}

      <PerplexityAttribution />
    </div>
  );
}
