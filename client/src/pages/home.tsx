import { useState, useEffect } from "react";
import { Link } from "wouter";
import { CrawlForm } from "@/components/CrawlForm";
import { CrawlProgress } from "@/components/CrawlProgress";
import { SitemapView } from "@/components/SitemapView";
import { useAuth } from "@/lib/auth";
import type { CrawlJob } from "@shared/schema";
import {
  Camera,
  Network,
  AlertTriangle,
  FolderTree,
  Zap,
  ArrowRight,
  Crown,
  Check,
  X,
  Infinity,
} from "lucide-react";

/* ── real website screenshot tiles ─────────────────────────── */
const TILE_IMAGES = [
  "./bg-tiles/stripe.jpg",
  "./bg-tiles/linear.jpg",
  "./bg-tiles/vercel.jpg",
  "./bg-tiles/notion.jpg",
  "./bg-tiles/figma.jpg",
  "./bg-tiles/github.jpg",
  "./bg-tiles/apple.jpg",
  "./bg-tiles/shopify.jpg",
  "./bg-tiles/webflow.jpg",
  "./bg-tiles/framer.jpg",
  "./bg-tiles/intercom.jpg",
  "./bg-tiles/mailchimp.jpg",
];

// Repeat tiles to fill the grid
const GRID_TILES = [...TILE_IMAGES, ...TILE_IMAGES, ...TILE_IMAGES].slice(0, 30);

function ScreenshotBackground() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {/* Tilted mosaic of real website screenshots */}
      <div
        className="absolute grid gap-3"
        style={{
          inset: "-60%",
          gridTemplateColumns: "repeat(5, 1fr)",
          gridAutoRows: "auto",
          transform: "rotate(-6deg) scale(1.15)",
          transformOrigin: "center center",
          filter: "blur(0.8px) saturate(0.9)",
          opacity: 0.75,
        }}
      >
        {GRID_TILES.map((src, i) => (
          <div key={i} className="overflow-hidden rounded-lg shadow-md border border-black/5" style={{ aspectRatio: "16/10" }}>
            <img
              src={src}
              alt=""
              className="w-full h-full object-cover object-top"
              draggable={false}
            />
          </div>
        ))}
      </div>
      {/* Dark overlay — keeps screenshots visible underneath */}
      <div className="absolute inset-0" style={{ background: "rgba(8,12,24,0.72)" }} />
      {/* Radial vignette — slightly lighter in center for text focus */}
      <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse 70% 60% at 50% 38%, rgba(8,12,24,0.15) 0%, rgba(8,12,24,0.45) 100%)" }} />
      {/* Edge fades top + bottom */}
      <div className="absolute inset-0" style={{ background: "linear-gradient(to bottom, rgba(8,12,24,0.40) 0%, transparent 18%, transparent 75%, rgba(8,12,24,0.50) 100%)" }} />
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
    <div className="group relative flex items-start gap-3 p-3.5 rounded-xl hover:bg-white/[0.06] transition-colors duration-200">
      <div className="w-9 h-9 rounded-lg bg-blue-400/15 flex items-center justify-center flex-shrink-0 group-hover:bg-blue-400/25 transition-colors">
        <Icon className="w-[18px] h-[18px] text-blue-400" />
      </div>
      <div>
        <h3 className="text-sm font-semibold text-white mb-0.5">{title}</h3>
        <p className="text-xs text-gray-400 leading-relaxed">{description}</p>
      </div>
    </div>
  );
}

function ComparisonRow({ text, included, pro }: { text: string; included?: boolean; pro?: boolean }) {
  return (
    <li className="flex items-center gap-2.5 text-sm">
      {included ? (
        <Check className={`w-4 h-4 flex-shrink-0 ${pro ? "text-blue-400" : "text-emerald-400"}`} />
      ) : (
        <X className="w-4 h-4 flex-shrink-0 text-gray-600" />
      )}
      <span className={included ? "text-gray-300" : "text-gray-600 line-through"}>{text}</span>
    </li>
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
  const { user, limits } = useAuth();
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [jobData, setJobData] = useState<CrawlJob | null>(null);
  const [isComplete, setIsComplete] = useState(false);

  // Remove dark mode for light homepage
  useEffect(() => {
    document.documentElement.classList.remove("dark");
  }, []);

  // Handle ?job=ID from dashboard links
  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
    const jobParam = params.get("job");
    if (jobParam && !currentJobId) {
      setCurrentJobId(jobParam);
    }
  }, [currentJobId]);

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
      style={{ fontFamily: "'General Sans', 'Inter', sans-serif", background: showLanding ? "#0a0e1a" : undefined }}
    >
      {/* Header */}
      <header className={`sticky top-0 z-50 border-b backdrop-blur-md ${showLanding ? "border-white/10 bg-[#0a0e1a]/80" : "border-border/60 bg-white/80"}`}>
        <div className="max-w-screen-xl mx-auto px-4 h-14 flex items-center justify-between">
          <button
            onClick={handleReset}
            className="flex items-center gap-2.5 hover:opacity-80 transition-opacity"
            data-testid="button-logo-home"
          >
            <SitemapLogo className={`w-7 h-7 ${showLanding ? "text-blue-400" : "text-primary"}`} />
            <span className={`font-semibold text-sm tracking-tight ${showLanding ? "text-white" : "text-foreground"}`}>
              The Visual Sitemapper
            </span>
          </button>
          <div className="flex items-center gap-3">
            {isComplete && (
              <button
                onClick={handleReset}
                data-testid="button-new-crawl"
                className={`flex items-center gap-1.5 text-sm font-medium transition-colors ${showLanding ? "text-blue-400 hover:text-blue-300" : "text-primary hover:text-primary/80"}`}
              >
                New Crawl
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
            {user ? (
              <Link href="/dashboard">
                <span className={`text-sm font-medium cursor-pointer ${showLanding ? "text-gray-300 hover:text-white" : "text-gray-600 hover:text-gray-900"}`} data-testid="link-dashboard">
                  {user.name}
                </span>
              </Link>
            ) : (
              <>
                <Link href="/login">
                  <span className={`text-sm font-medium cursor-pointer ${showLanding ? "text-gray-300 hover:text-white" : "text-gray-600 hover:text-gray-900"}`} data-testid="link-login">
                    Sign In
                  </span>
                </Link>
                <Link href="/pricing">
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-white bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 px-3 py-1.5 rounded-full cursor-pointer" data-testid="link-go-pro">
                    <Crown className="w-3 h-3" />
                    Go Pro
                  </span>
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Landing hero — dark with screenshot tile background */}
      {showLanding && (
        <div className="relative min-h-[calc(100vh-56px)]" style={{ background: "#0a0e1a" }}>
          <ScreenshotBackground />
          <div className="relative max-w-screen-xl mx-auto px-4 pt-16 pb-10">
            {/* Hero text */}
            <div className="max-w-2xl mx-auto text-center mb-10">
              <div className="inline-flex items-center gap-2 mb-6">
                <div
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full"
                  style={{ background: "rgba(59,130,246,0.15)", border: "1px solid rgba(59,130,246,0.30)" }}
                >
                  <Zap className="w-3.5 h-3.5 text-blue-500" />
                  <span className="text-xs font-medium text-blue-300">
                    Crawl up to {limits?.maxPages ?? 100} pages per site
                  </span>
                </div>
                <Link href="/pricing">
                  <span
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium text-amber-300 cursor-pointer hover:text-amber-200 transition-colors"
                    style={{ background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.30)" }}
                  >
                    <Crown className="w-3.5 h-3.5 text-amber-400" />
                    Pro: 1,000 pages &amp; unlimited sitemaps
                  </span>
                </Link>
              </div>
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4 text-white">
                See your website,{" "}
                <span className="bg-gradient-to-r from-blue-500 to-cyan-500 bg-clip-text text-transparent">
                  visually mapped
                </span>
              </h1>
              <p className="text-base text-gray-300 leading-relaxed max-w-lg mx-auto">
                Enter any domain to crawl its pages, capture screenshots, and
                generate an interactive visual sitemap with hierarchy and page
                details.
              </p>
            </div>

            {/* Crawl form — clean white card */}
            <div className="max-w-lg mx-auto">
              <div
                className="rounded-2xl p-6 border"
                style={{
                  background: "rgba(255,255,255,0.9)",
                  backdropFilter: "blur(16px)",
                  borderColor: "rgba(0,0,0,0.07)",
                  boxShadow: "0 4px 32px rgba(0,0,0,0.08), 0 1px 4px rgba(0,0,0,0.04)",
                }}
              >
                <CrawlForm onCrawlStarted={handleCrawlStarted} />
              </div>
            </div>

            {/* Feature cards */}
            <div
              className="max-w-2xl mx-auto mt-16 grid grid-cols-1 sm:grid-cols-2 gap-1 rounded-2xl p-2"
              style={{ background: "rgba(255,255,255,0.06)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.08)" }}
            >
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

            {/* Pro vs Free comparison section */}
            <div className="max-w-3xl mx-auto mt-20 mb-8">
              <div className="text-center mb-10">
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-4" style={{ background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.30)" }}>
                  <Crown className="w-3.5 h-3.5 text-amber-400" />
                  <span className="text-xs font-medium text-amber-300">Unlock the full power</span>
                </div>
                <h2 className="text-2xl sm:text-3xl font-bold text-white mb-3">Free vs. Pro</h2>
                <p className="text-gray-400 text-sm max-w-md mx-auto">The free plan is great for quick audits. Go Pro to map entire websites with no limits.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Free tier card */}
                <div className="rounded-2xl p-6" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <h3 className="text-lg font-bold text-white mb-1">Free</h3>
                  <p className="text-2xl font-bold text-white mb-5">$0 <span className="text-sm font-normal text-gray-500">forever</span></p>
                  <ul className="space-y-3">
                    <ComparisonRow text="Up to 100 pages per sitemap" included />
                    <ComparisonRow text="5 sitemaps per month" included />
                    <ComparisonRow text="Visual sitemap with screenshots" included />
                    <ComparisonRow text="Broken link detection" included />
                    <ComparisonRow text="Subfolder filtering" included />
                    <ComparisonRow text="Unlimited sitemaps" />
                    <ComparisonRow text="Up to 1,000 pages per sitemap" />
                    <ComparisonRow text="Priority crawl speed" />
                  </ul>
                  <Link href="/register">
                    <button className="w-full mt-6 py-2.5 rounded-lg text-sm font-medium text-white border border-white/15 hover:bg-white/10 transition-colors cursor-pointer" data-testid="button-free-signup">
                      Get Started Free
                    </button>
                  </Link>
                </div>

                {/* Pro tier card */}
                <div className="rounded-2xl p-6 relative overflow-hidden" style={{ background: "linear-gradient(135deg, rgba(59,130,246,0.12) 0%, rgba(6,182,212,0.10) 100%)", border: "1px solid rgba(59,130,246,0.25)" }}>
                  <div className="absolute top-3 right-3 text-[10px] font-bold uppercase tracking-wider text-amber-400 bg-amber-400/10 px-2 py-1 rounded-full">Most Popular</div>
                  <div className="flex items-center gap-2 mb-1">
                    <Crown className="w-4 h-4 text-amber-400" />
                    <h3 className="text-lg font-bold text-white">Pro</h3>
                  </div>
                  <p className="text-2xl font-bold text-white mb-5">$49 <span className="text-sm font-normal text-gray-400">/month</span></p>
                  <ul className="space-y-3">
                    <ComparisonRow text="Up to 1,000 pages per sitemap" included pro />
                    <ComparisonRow text="Unlimited sitemaps" included pro />
                    <ComparisonRow text="Visual sitemap with screenshots" included pro />
                    <ComparisonRow text="Broken link detection" included pro />
                    <ComparisonRow text="Subfolder filtering" included pro />
                    <ComparisonRow text="Priority crawl speed" included pro />
                    <ComparisonRow text="Export & sharing (coming soon)" included pro />
                  </ul>
                  <button
                    onClick={() => { window.location.hash = user ? "#/pricing" : "#/register/pro"; }}
                    className="w-full mt-6 py-2.5 rounded-lg text-sm font-bold text-white bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 transition-colors cursor-pointer"
                    data-testid="button-go-pro"
                  >
                    Upgrade to Pro
                  </button>
                </div>
              </div>

              {/* Bottom nudge */}
              <p className="text-center text-xs text-gray-500 mt-6">Cancel anytime. No contracts. Payments via Stripe.</p>
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

    </div>
  );
}
