import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, Search, Settings2, Crown } from "lucide-react";
import { useAuth } from "@/lib/auth";

interface CrawlFormProps {
  onCrawlStarted: (jobId: string) => void;
}

export function CrawlForm({ onCrawlStarted }: CrawlFormProps) {
  const { limits, user } = useAuth();
  const tierMaxPages = limits?.maxPages ?? 100;
  const tierMaxDepth = limits?.maxDepth ?? 5;
  const isPro = user?.tier === "pro";
  const [url, setUrl] = useState("");
  const [maxPages, setMaxPages] = useState(tierMaxPages);
  const [maxDepth, setMaxDepth] = useState(tierMaxDepth);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    setError(null);
    setIsSubmitting(true);

    try {
      let normalizedUrl = url.trim();
      if (!normalizedUrl.startsWith("http")) {
        normalizedUrl = "https://" + normalizedUrl;
      }
      // Validate URL
      new URL(normalizedUrl);

      const res = await apiRequest("POST", "/api/crawl", {
        url: normalizedUrl,
        maxPages,
        maxDepth,
      });
      const data = await res.json();
      onCrawlStarted(data.jobId);
    } catch (err: any) {
      setError(err.message || "Failed to start crawl");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="max-w-lg mx-auto p-6 border border-border/60">
      {isPro && (
        <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-lg bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200/60">
          <Crown className="w-4 h-4 text-amber-500" />
          <span className="text-xs font-semibold text-amber-700">Pro Mode</span>
          <span className="text-xs text-amber-600/80 ml-auto">1,000 pages &middot; Unlimited sitemaps</span>
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="url" className="text-sm font-medium">
            Website URL
          </Label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              id="url"
              data-testid="input-url"
              type="text"
              placeholder="example.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="pl-10 h-11"
              autoFocus
            />
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          data-testid="button-advanced"
        >
          <Settings2 className="w-3.5 h-3.5" />
          {showAdvanced ? "Hide" : "Show"} advanced options
        </button>

        {showAdvanced && (
          <div className="space-y-4 pt-1">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Max pages</Label>
                <span className="text-xs font-mono text-muted-foreground">{maxPages}</span>
              </div>
              <Slider
                data-testid="slider-max-pages"
                value={[maxPages]}
                onValueChange={([v]) => setMaxPages(v)}
                min={5}
                max={tierMaxPages}
                step={5}
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Max depth</Label>
                <span className="text-xs font-mono text-muted-foreground">{maxDepth}</span>
              </div>
              <Slider
                data-testid="slider-max-depth"
                value={[maxDepth]}
                onValueChange={([v]) => setMaxDepth(v)}
                min={1}
                max={tierMaxDepth}
                step={1}
              />
            </div>
          </div>
        )}

        {error && (
          <p className="text-sm text-destructive" data-testid="text-error">
            {error}
          </p>
        )}

        <Button
          type="submit"
          className="w-full h-11"
          disabled={isSubmitting || !url.trim()}
          data-testid="button-crawl"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Starting...
            </>
          ) : (
            "Generate Sitemap"
          )}
        </Button>
      </form>
    </Card>
  );
}
