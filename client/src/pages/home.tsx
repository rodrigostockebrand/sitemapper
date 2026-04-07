import { useState, useEffect } from "react";
import { CrawlForm } from "@/components/CrawlForm";
import { CrawlProgress } from "@/components/CrawlProgress";
import { SitemapView } from "@/components/SitemapView";
import { PerplexityAttribution } from "@/components/PerplexityAttribution";
import type { CrawlJob } from "@shared/schema";
import {
  Camera,
  Network,
  AlertTriangle,
  FolderTree,
  Zap,
  ArrowRight,
} from "lucide-react";

/* ── real website screenshot tiles ─────────────────────────── */
const TILE_IMAGES = [
  "/bg-tiles/stripe.jpg",
  "/bg-tiles/linear.jpg",
  "/bg-tiles/vercel.jpg",
  "/bg-tiles/notion.jpg",
  "/bg-tiles/figma.jpg",
  "/bg-tiles/github.jpg",
  "/bg-tiles/apple.jpg",
  "/bg-tiles/shopify.jpg",
  "/bg-tiles/webflow.jpg",
  "/bg-tiles/framer.jpg",
  "/bg-tiles/intercom.jpg",
  "/bg-tiles/mailchimp.jpg",
];

// Repeat tiles to fill the grid
const GRID_TILES = [...TILE_IMAGES, ...TILE_IMAGES, ...TILE_IMAGES].slice(0, 30);

function ScreenshotBackground() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {/* Tilted mosaic of real website screenshots */}
      <div
        className="absolute grid gap-2"
        style={{
          inset: "-60%",
          gridTemplateColumns: "repeat(5, 1fr)",
          gridAutoRows: "auto",
          transform: "rotate(-8deg) scale(1.1)",
          transformOrigin: "center center",
          filter: "blur(2px) brightness(0.65) saturate(0.9)",
        }}
      >
        {GRID_TILES.map((src, i) => (
          <div key={i} className="overflow-hidden rounded-lg shadow-xl" style={{ aspectRatio: "16/10" }}>
            <img
              src={src}
              alt=""
              className="w-full h-full object-cover object-top"
              draggable={false}
            />
          </div>
        ))}
      </div>
      {/* Dark vignette + gradient overlays */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#080810]/65 via-[#080810]/40 to-[#080810]/80" />
      <div className="absolute inset-0 bg-gradient-to-r from-[#080810]/55 via-transparent to-[#080810]/55" />
      {/* Subtle blue glow behind the form */}
      <div
        className="absolute top-[28%] left-1/2 -translate-x-1/2 w-[600px] h-[400px] rounded-full"
        style={{ background: "radial-gradient(ellipse, rgba(59,130,246,0.1) 0%, transparent 70%)" }}
      />
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
    <div className="group relative flex items-start gap-3 p-3.5 rounded-xl hover:bg-white/[0.04] transition-colors duration-200">
      <div className="w-9 h-9 rounded-lg bg-blue-500/10 flex items-center justify-center flex-shrink-0 group-hover:bg-blue-500/15 transition-colors">
        <Icon className="w-[18px] h-[18px] text-blue-400" />
      </div>
      <div>
        <h3 className="text-sm font-semibold text-white/90 mb-0.5">{title}</h3>
        <p className="text-xs text-white/50 leading-relaxed">{description}</p>
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
      <rect x="11" y="3" width="10" height="8" rx="2" stroke="currentColor" strokeWidth="2" />
      <rect x="1" y="21" width="10" height="8" rx="2" stroke="currentColor" strokeWidth="2" />
      <rect x="21" y="21" width="10" height="8" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M16 11V15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M6 21V17H26V21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16 15V17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
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

  // Force dark mode on the landing page
  useEffect(() => {
    if (!currentJobId && !isComplete) {
      document.documentElement.classList.add("dark");
    }
    return () => {
      // Keep dark mode for result views too — remove this if you want light results
    };
  }, [currentJobId, isComplete]);

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

  const showLanding = !currentJobId && !isComplete;

  return (
    <div
      className="min-h-screen"
      style={{
        fontFamily: "'General Sans', 'Inter', sans-serif",
        background: showLanding ? "#0a0a12" : undefined,
        color: showLanding ? "#e2e8f0" : undefined,
      }}
    >
      {/* Header */}
      <header
        className="sticky top-0 z-50 border-b backdrop-blur-md"
        style={
          showLanding
            ? { background: "rgba(10,10,18,0.7)", borderColor: "rgba(255,255,255,0.08)" }
            : undefined
        }
      >
        <div className="max-w-screen-xl mx-auto px-4 h-14 flex items-center justify-between">
          <button
            onClick={handleReset}
            className="flex items-center gap-2.5 hover:opacity-80 transition-opacity"
            data-testid="button-logo-home"
          >
            <SitemapLogo className="w-7 h-7" style={{ color: showLanding ? "#60a5fa" : "hsl(var(--primary))" }} />
            <span
              className="font-semibold text-sm tracking-tight"
              style={{ color: showLanding ? "#f1f5f9" : undefined }}
            >
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

      {/* Landing hero — dark with screenshot tile background */}
      {showLanding && (
        <div className="relative min-h-[calc(100vh-56px)]">
          <ScreenshotBackground />
          <div className="relative max-w-screen-xl mx-auto px-4 pt-16 pb-10">
            {/* Hero text */}
            <div className="max-w-2xl mx-auto text-center mb-10">
              <div
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-6"
                style={{ background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.2)" }}
              >
                <Zap className="w-3.5 h-3.5 text-blue-400" />
                <span className="text-xs font-medium text-blue-300">
                  Crawl up to 200 pages per site
                </span>
              </div>
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4 text-white">
                See your website,{" "}
                <span className="bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
                  visually mapped
                </span>
              </h1>
              <p className="text-base text-white/55 leading-relaxed max-w-lg mx-auto">
                Enter any domain to crawl its pages, capture screenshots, and
                generate an interactive visual sitemap with hierarchy and page
                details.
              </p>
            </div>

            {/* Crawl form — with dark glass card */}
            <div className="max-w-lg mx-auto">
              <div
                className="rounded-2xl p-6 border"
                style={{
                  background: "rgba(15,15,25,0.75)",
                  backdropFilter: "blur(20px)",
                  borderColor: "rgba(255,255,255,0.08)",
                  boxShadow: "0 0 60px rgba(59,130,246,0.06), 0 4px 24px rgba(0,0,0,0.4)",
                }}
              >
                <CrawlForm onCrawlStarted={handleCrawlStarted} />
              </div>
            </div>

            {/* Feature cards */}
            <div className="max-w-2xl mx-auto mt-16 grid grid-cols-1 sm:grid-cols-2 gap-1">
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
