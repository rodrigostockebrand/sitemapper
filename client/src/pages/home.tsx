import { useState } from "react";
import { CrawlForm } from "@/components/CrawlForm";
import { CrawlProgress } from "@/components/CrawlProgress";
import { SitemapView } from "@/components/SitemapView";
import { PerplexityAttribution } from "@/components/PerplexityAttribution";
import type { CrawlJob } from "@shared/schema";
import {
  Globe,
  Map,
  Camera,
  Network,
  AlertTriangle,
  FolderTree,
  Zap,
  ArrowRight,
} from "lucide-react";

function AnimatedGrid() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {/* Grid pattern */}
      <svg
        className="absolute inset-0 w-full h-full opacity-[0.035]"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="currentColor" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
      </svg>
      {/* Gradient orbs */}
      <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] rounded-full bg-primary/5 blur-[100px] animate-pulse" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[400px] h-[400px] rounded-full bg-primary/8 blur-[120px] animate-pulse" style={{ animationDelay: "1s" }} />
      {/* Floating connector lines */}
      <svg className="absolute top-20 right-10 w-60 h-60 opacity-[0.06]" viewBox="0 0 200 200">
        <circle cx="30" cy="30" r="6" fill="currentColor" />
        <circle cx="170" cy="50" r="6" fill="currentColor" />
        <circle cx="100" cy="140" r="6" fill="currentColor" />
        <circle cx="50" cy="170" r="4" fill="currentColor" />
        <line x1="30" y1="30" x2="170" y2="50" stroke="currentColor" strokeWidth="1.5" />
        <line x1="170" y1="50" x2="100" y2="140" stroke="currentColor" strokeWidth="1.5" />
        <line x1="30" y1="30" x2="100" y2="140" stroke="currentColor" strokeWidth="1.5" />
        <line x1="100" y1="140" x2="50" y2="170" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      <svg className="absolute bottom-32 left-8 w-40 h-40 opacity-[0.05]" viewBox="0 0 150 150">
        <circle cx="20" cy="20" r="5" fill="currentColor" />
        <circle cx="130" cy="30" r="5" fill="currentColor" />
        <circle cx="75" cy="120" r="5" fill="currentColor" />
        <line x1="20" y1="20" x2="130" y2="30" stroke="currentColor" strokeWidth="1.5" />
        <line x1="130" y1="30" x2="75" y2="120" stroke="currentColor" strokeWidth="1.5" />
        <line x1="20" y1="20" x2="75" y2="120" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </div>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  description,
}: {
  icon: any;
  title: string;
  description: string;
}) {
  return (
    <div className="group relative flex items-start gap-3 p-3.5 rounded-xl hover:bg-card/80 transition-colors duration-200">
      <div className="w-9 h-9 rounded-lg bg-primary/8 flex items-center justify-center flex-shrink-0 group-hover:bg-primary/12 transition-colors">
        <Icon className="w-4.5 h-4.5 text-primary" />
      </div>
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-0.5">{title}</h3>
        <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
      </div>
    </div>
  );
}

function SitemapLogo({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="The Visual Sitemapper logo"
    >
      {/* Central node */}
      <rect x="11" y="3" width="10" height="8" rx="2" stroke="currentColor" strokeWidth="2" />
      {/* Left branch node */}
      <rect x="1" y="21" width="10" height="8" rx="2" stroke="currentColor" strokeWidth="2" />
      {/* Right branch node */}
      <rect x="21" y="21" width="10" height="8" rx="2" stroke="currentColor" strokeWidth="2" />
      {/* Connection lines */}
      <path d="M16 11V15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M6 21V17H26V21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16 15V17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      {/* Dot accents inside boxes */}
      <rect x="14" y="5.5" width="4" height="3" rx="0.75" fill="currentColor" opacity="0.4" />
      <rect x="4" y="23.5" width="4" height="3" rx="0.75" fill="currentColor" opacity="0.4" />
      <rect x="24" y="23.5" width="4" height="3" rx="0.75" fill="currentColor" opacity="0.4" />
    </svg>
  );
}

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
    <div className="min-h-screen bg-background" style={{ fontFamily: "'General Sans', 'Inter', sans-serif" }}>
      {/* Header */}
      <header className="border-b border-border/60 bg-card/60 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-screen-xl mx-auto px-4 h-14 flex items-center justify-between">
          <button
            onClick={handleReset}
            className="flex items-center gap-2.5 hover:opacity-80 transition-opacity"
            data-testid="button-logo-home"
          >
            <SitemapLogo className="w-7 h-7 text-primary" />
            <span className="font-semibold text-sm tracking-tight">
              The Visual Sitemapper
            </span>
          </button>
          {isComplete && (
            <button
              onClick={handleReset}
              data-testid="button-new-crawl"
              className="flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 font-medium transition-colors"
            >
              New Crawl
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </header>

      {/* Landing hero */}
      {!currentJobId && !isComplete && (
        <div className="relative">
          <AnimatedGrid />
          <div className="relative max-w-screen-xl mx-auto px-4 pt-16 pb-10">
            {/* Hero text */}
            <div className="max-w-2xl mx-auto text-center mb-10">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/8 border border-primary/15 mb-6">
                <Zap className="w-3.5 h-3.5 text-primary" />
                <span className="text-xs font-medium text-primary">
                  Crawl up to 200 pages per site
                </span>
              </div>
              <h1
                className="text-3xl sm:text-4xl font-bold tracking-tight mb-4 bg-gradient-to-br from-foreground via-foreground to-muted-foreground bg-clip-text"
              >
                See your website,{" "}
                <span className="text-primary">visually mapped</span>
              </h1>
              <p className="text-base text-muted-foreground leading-relaxed max-w-lg mx-auto">
                Enter any domain to crawl its pages, capture screenshots, and
                generate an interactive visual sitemap with hierarchy and page
                details.
              </p>
            </div>

            {/* Crawl form */}
            <CrawlForm onCrawlStarted={handleCrawlStarted} />

            {/* Feature cards */}
            <div className="max-w-2xl mx-auto mt-14 grid grid-cols-1 sm:grid-cols-2 gap-1">
              <FeatureCard
                icon={Network}
                title="Automatic crawling"
                description="BFS crawl discovers every page linked from your starting URL, following the site's natural structure."
              />
              <FeatureCard
                icon={Camera}
                title="Page screenshots"
                description="Full-page screenshots for every crawled page so you can see exactly what visitors see."
              />
              <FeatureCard
                icon={FolderTree}
                title="Folder filtering"
                description="Narrow your crawl to a specific subfolder path like /blog/ or /products/ for focused results."
              />
              <FeatureCard
                icon={AlertTriangle}
                title="Broken link detection"
                description="Pages returning 4xx or 5xx errors are flagged with a red border so you spot issues fast."
              />
            </div>
          </div>
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
