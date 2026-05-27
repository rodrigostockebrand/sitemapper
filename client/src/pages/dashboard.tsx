import { useEffect, useState } from "react";
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
  Trash2,
  X,
  ChevronDown,
  LogOut,
  LayoutDashboard,
  Sun,
  Moon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useTheme } from "@/lib/theme";
import { apiRequest, queryClient } from "@/lib/queryClient";
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
      return <Badge className="bg-emerald-100 text-emerald-700 border-0 dark:bg-emerald-500/15 dark:text-emerald-300"><CheckCircle2 className="w-3 h-3 mr-1" />Complete</Badge>;
    case "error":
      return <Badge className="bg-red-100 text-red-700 border-0 dark:bg-red-500/15 dark:text-red-300"><AlertCircle className="w-3 h-3 mr-1" />Error</Badge>;
    case "crawling":
    case "screenshotting":
      return <Badge className="bg-blue-100 text-blue-700 border-0 dark:bg-blue-500/15 dark:text-blue-300"><Loader2 className="w-3 h-3 mr-1 animate-spin" />In Progress</Badge>;
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
  const { user, limits, crawlsThisMonth, crawlsRemaining, loading: authLoading, logout } = useAuth();
  const { theme, toggle: toggleTheme } = useTheme();
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

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

  async function handleDelete(id: string) {
    setDeleting(id);
    try {
      await apiRequest("DELETE", `/api/crawls/${id}`);
      queryClient.invalidateQueries({ queryKey: ["/api/crawls"] });
      toast({ title: "Sitemap deleted" });
    } catch (err: any) {
      toast({ title: "Error", description: "Could not delete sitemap.", variant: "destructive" });
    } finally {
      setDeleting(null);
      setConfirmDeleteId(null);
    }
  }

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#f8f9fc] flex items-center justify-center dark:bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400 dark:text-muted-foreground/70" />
      </div>
    );
  }

  if (!user) return null;

  const isFree = user.tier === "free";

  return (
    <div className="min-h-screen bg-[#f8f9fc] dark:bg-background">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-50 dark:bg-card dark:border-border">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/">
            <span className="text-lg font-bold text-gray-900 cursor-pointer dark:text-foreground">The Visual Sitemapper</span>
          </Link>
          <div className="flex items-center gap-3">
            {isFree && (
              <Link href="/pricing">
                <Button size="sm" variant="outline" className="text-xs border-amber-200 text-amber-700 hover:bg-amber-50 dark:border-amber-500/40 dark:text-amber-300 dark:hover:bg-amber-500/10">
                  <Crown className="w-3.5 h-3.5 mr-1" />
                  Upgrade to Pro
                </Button>
              </Link>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 outline-none dark:text-foreground dark:text-muted-foreground dark:hover:text-foreground"
                  data-testid="button-user-menu"
                >
                  {user.name}
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <Link href="/">
                  <DropdownMenuItem className="cursor-pointer" data-testid="menuitem-home">
                    <LayoutDashboard className="w-4 h-4 mr-2" />
                    New crawl
                  </DropdownMenuItem>
                </Link>
                {!isFree && (
                  <DropdownMenuItem
                    onClick={handleManageBilling}
                    className="cursor-pointer"
                    data-testid="menuitem-billing"
                  >
                    <CreditCard className="w-4 h-4 mr-2" />
                    Billing &amp; receipts
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onClick={(e) => {
                    e.preventDefault();
                    toggleTheme();
                  }}
                  className="cursor-pointer"
                  data-testid="menuitem-theme"
                >
                  {theme === "dark" ? (
                    <Sun className="w-4 h-4 mr-2" />
                  ) : (
                    <Moon className="w-4 h-4 mr-2" />
                  )}
                  {theme === "dark" ? "Light mode" : "Dark mode"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => {
                    logout();
                    navigate("/");
                  }}
                  className="cursor-pointer text-red-600 focus:text-red-700 focus:bg-red-50 dark:text-red-400 dark:focus:text-red-300 dark:focus:bg-red-950/40"
                  data-testid="menuitem-logout"
                >
                  <LogOut className="w-4 h-4 mr-2" />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        {/* Usage bar */}
        <div className="bg-white rounded-xl border border-gray-200/60 shadow-sm p-5 mb-8 dark:bg-card dark:border-border">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 dark:text-foreground">
                {isFree ? "Free Plan" : <><Crown className="w-4 h-4 text-amber-500" /> Pro Plan</>}
              </h2>
              <p className="text-xs text-gray-500 mt-0.5 dark:text-muted-foreground">
                {isFree
                  ? `${crawlsThisMonth} of ${limits?.monthlyCredits ?? 5} sitemaps used this month · Max ${limits?.maxPages ?? 100} pages per crawl`
                  : `Unlimited sitemaps · Up to ${limits?.maxPages ?? 1000} pages per crawl`}
              </p>
              {!isFree && (
                <button
                  onClick={handleManageBilling}
                  className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors mt-1 dark:text-muted-foreground"
                >
                  <CreditCard className="w-3 h-3" />
                  Billing &amp; receipts
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
            <div className="w-full bg-gray-100 rounded-full h-2 dark:bg-muted/40">
              <div
                className="bg-gradient-to-r from-blue-500 to-cyan-500 h-2 rounded-full transition-all"
                style={{ width: `${Math.min(100, (crawlsThisMonth / limits.monthlyCredits) * 100)}%` }}
              />
            </div>
          )}
        </div>

        {/* Crawl history */}
        <h2 className="text-lg font-bold text-gray-900 mb-4 dark:text-foreground">Your Sitemaps</h2>

        {isLoading ? (
          <div className="text-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400 mx-auto dark:text-muted-foreground/70" />
          </div>
        ) : !crawls || crawls.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-xl border border-gray-200/60 dark:bg-card dark:border-border">
            <Globe className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 mb-1 dark:text-muted-foreground">No sitemaps yet</p>
            <p className="text-sm text-gray-400 mb-4 dark:text-muted-foreground/70">Generate your first visual sitemap to get started.</p>
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
              <div key={crawl.id} className="relative group">
                <Link href={`/job/${crawl.id}`}>
                  <div className="bg-white rounded-xl border border-gray-200/60 shadow-sm p-4 hover:border-blue-200 hover:shadow-md transition-all cursor-pointer dark:bg-card dark:border-border dark:hover:border-primary/40" data-testid={`crawl-item-${crawl.id}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-gray-50 flex items-center justify-center dark:bg-muted/30">
                          <Globe className="w-4 h-4 text-gray-500 dark:text-muted-foreground" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-gray-900 dark:text-foreground">{crawl.domain}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs text-gray-400 flex items-center gap-1 dark:text-muted-foreground/70">
                              <Clock className="w-3 h-3" />
                              {timeAgo(crawl.startedAt)}
                            </span>
                            <span className="text-xs text-gray-400 dark:text-muted-foreground/70">·</span>
                            <span className="text-xs text-gray-400 dark:text-muted-foreground/70">{crawl.totalPages} pages</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {statusBadge(crawl.status)}
                      </div>
                    </div>
                  </div>
                </Link>

                {/* Delete button — shows on hover */}
                {confirmDeleteId === crawl.id ? (
                  <div
                    className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 bg-white border border-red-200 rounded-lg px-2 py-1.5 shadow-lg z-10 dark:bg-card dark:border-red-500/40"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span className="text-xs text-red-600 font-medium whitespace-nowrap dark:text-red-400">Delete this sitemap?</span>
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleDelete(crawl.id);
                      }}
                      disabled={deleting === crawl.id}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-white bg-red-500 hover:bg-red-600 rounded-md transition-colors disabled:opacity-50"
                      data-testid={`confirm-delete-${crawl.id}`}
                    >
                      {deleting === crawl.id ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Trash2 className="w-3 h-3" />
                      )}
                      Yes
                    </button>
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setConfirmDeleteId(null);
                      }}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors dark:bg-muted/40 dark:text-muted-foreground dark:hover:bg-muted/50"
                    >
                      <X className="w-3 h-3" />
                      No
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setConfirmDeleteId(crawl.id);
                    }}
                    className="absolute right-14 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-1.5 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 transition-all z-10 dark:text-muted-foreground/70"
                    title="Delete sitemap"
                    data-testid={`delete-btn-${crawl.id}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
