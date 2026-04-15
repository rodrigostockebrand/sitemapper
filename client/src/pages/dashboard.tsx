import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Globe,
  Clock,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Plus,
  Crown,
  Zap,
  CreditCard,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface CrawlSummary {
  id: string;
  domain: string;
  status: string;
  totalPages: number;
  startedAt: string;
  completedAt: string | null;
}

function statusBadge(status: string) {
  switch (status) {
    case "complete":
      return <Badge className="bg-emerald-100 text-emerald-700 border-0"><CheckCircle2 className="w-3 h-3 mr-1" />Complete</Badge>;
    case "error":
      return <Badge className="bg-red-100 text-red-700 border-0"><AlertCircle className="w-3 h-3 mr-1" />Error</Badge>;
    case "crawling":
    case "screenshotting":
      return <Badge className="bg-blue-100 text-blue-700 border-0"><Loader2 className="w-3 h-3 mr-1 animate-spin" />In Progress</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export default function DashboardPage() {
  const [, navigate] = useLocation();
  const { user, limits, crawlsThisMonth, crawlsRemaining, loading: authLoading } = useAuth();

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/login");
    }
  }, [authLoading, user, navigate]);

  const { toast } = useToast();

  const { data: crawls, isLoading } = useQuery<CrawlSummary[]>({
    queryKey: ["/api/crawls"],
    enabled: !!user,
  });

  async function handleManageBilling() {
    try {
      const res = await apiRequest("POST", "/api/billing/portal");
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (err: any) {
      toast({ title: "Error", description: "Could not open billing portal.", variant: "destructive" });
    }
  }

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#f8f9fc] flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!user) return null;

  const isFree = user.tier === "free";

  return (
    <div className="min-h-screen bg-[#f8f9fc]">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/">
            <span className="text-lg font-bold text-gray-900 cursor-pointer">The Visual Sitemapper</span>
          </Link>
          <div className="flex items-center gap-3">
            {isFree && (
              <Link href="/pricing">
                <Button size="sm" variant="outline" className="text-xs border-amber-200 text-amber-700 hover:bg-amber-50">
                  <Crown className="w-3.5 h-3.5 mr-1" />
                  Upgrade to Pro
                </Button>
              </Link>
            )}
            <span className="text-sm text-gray-500">{user.name}</span>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        {/* Usage bar */}
        <div className="bg-white rounded-xl border border-gray-200/60 shadow-sm p-5 mb-8">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                {isFree ? "Free Plan" : <><Crown className="w-4 h-4 text-amber-500" /> Pro Plan</>}
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                {isFree
                  ? `${crawlsThisMonth} of ${limits?.monthlyCredits ?? 5} sitemaps used this month · Max ${limits?.maxPages ?? 100} pages per crawl`
                  : `Unlimited sitemaps · Up to ${limits?.maxPages ?? 1000} pages per crawl`}
              </p>
              {!isFree && (
                <button
                  onClick={handleManageBilling}
                  className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors mt-1"
                >
                  <CreditCard className="w-3 h-3" />
                  Manage billing
                </button>
              )}
            </div>
            <Link href="/">
              <Button size="sm" className="bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white">
                <Plus className="w-4 h-4 mr-1" />
                New Sitemap
              </Button>
            </Link>
          </div>

          {isFree && limits && (
            <div className="w-full bg-gray-100 rounded-full h-2">
              <div
                className="bg-gradient-to-r from-blue-500 to-cyan-500 h-2 rounded-full transition-all"
                style={{ width: `${Math.min(100, (crawlsThisMonth / limits.monthlyCredits) * 100)}%` }}
              />
            </div>
          )}
        </div>

        {/* Crawl history */}
        <h2 className="text-lg font-bold text-gray-900 mb-4">Your Sitemaps</h2>

        {isLoading ? (
          <div className="text-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400 mx-auto" />
          </div>
        ) : !crawls || crawls.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-xl border border-gray-200/60">
            <Globe className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 mb-1">No sitemaps yet</p>
            <p className="text-sm text-gray-400 mb-4">Generate your first visual sitemap to get started.</p>
            <Link href="/">
              <Button size="sm" className="bg-gradient-to-r from-blue-500 to-cyan-500 text-white">
                <Zap className="w-4 h-4 mr-1" />
                Generate Sitemap
              </Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {crawls.map((crawl) => (
              <Link key={crawl.id} href={`/job/${crawl.id}`}>
                <div className="bg-white rounded-xl border border-gray-200/60 shadow-sm p-4 hover:border-blue-200 hover:shadow-md transition-all cursor-pointer" data-testid={`crawl-item-${crawl.id}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-gray-50 flex items-center justify-center">
                        <Globe className="w-4 h-4 text-gray-500" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{crawl.domain}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-gray-400 flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {timeAgo(crawl.startedAt)}
                          </span>
                          <span className="text-xs text-gray-400">·</span>
                          <span className="text-xs text-gray-400">{crawl.totalPages} pages</span>
                        </div>
                      </div>
                    </div>
                    {statusBadge(crawl.status)}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
