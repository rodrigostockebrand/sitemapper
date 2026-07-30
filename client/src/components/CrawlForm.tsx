import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, Search, Settings2, Crown, Shield, Upload, Link2, ListChecks } from "lucide-react";
import { useAuth } from "@/lib/auth";

interface CrawlFormProps {
  onCrawlStarted: (jobId: string) => void;
}

type Mode = "url" | "list";

export function CrawlForm({ onCrawlStarted }: CrawlFormProps) {
  const { limits, user } = useAuth();
  const tierMaxPages = limits?.maxPages ?? 100;
  const tierMaxDepth = limits?.maxDepth ?? 5;
  const isPro = user?.tier === "pro";
  const isOwner = user?.tier === "owner";

  const [mode, setMode] = useState<Mode>("url");
  const [url, setUrl] = useState("");
  const [urlList, setUrlList] = useState("");
  const [maxPages, setMaxPages] = useState(Math.min(tierMaxPages, isOwner ? 500 : tierMaxPages));
  const [maxDepth, setMaxDepth] = useState(tierMaxDepth);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Parse & validate the pasted URL list. Accepts URLs one per line, blank
  // lines and comments (#) are ignored. Adds https:// if missing.
  const parseSeedUrls = (raw: string): { valid: string[]; invalid: string[] } => {
    const valid: string[] = [];
    const invalid: string[] = [];
    const seen = new Set<string>();
    for (const rawLine of raw.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      let candidate = line;
      if (!/^https?:\/\//i.test(candidate)) {
        candidate = "https://" + candidate;
      }
      try {
        const parsed = new URL(candidate);
        const normalized = parsed.toString();
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        valid.push(normalized);
      } catch {
        invalid.push(line);
      }
    }
    return { valid, invalid };
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      setUrlList((prev) => (prev.trim() ? prev.trim() + "\n" : "") + text.trim());
    } catch (err: any) {
      setError("Could not read file: " + (err.message || "unknown error"));
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (mode === "url") {
      if (!url.trim()) return;
      setIsSubmitting(true);
      try {
        let normalizedUrl = url.trim();
        if (!normalizedUrl.startsWith("http")) {
          normalizedUrl = "https://" + normalizedUrl;
        }
        new URL(normalizedUrl); // validate
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
      return;
    }

    // URL list mode
    const { valid, invalid } = parseSeedUrls(urlList);
    if (valid.length === 0) {
      setError("Add at least one valid URL to the list.");
      return;
    }
    if (invalid.length > 0) {
      setError(
        `${invalid.length} invalid line${invalid.length === 1 ? "" : "s"} skipped. Starting crawl with ${valid.length} valid URL${valid.length === 1 ? "" : "s"}.`
      );
    }
    if (valid.length > tierMaxPages) {
      setError(`Your tier allows ${tierMaxPages.toLocaleString()} pages max. Trimming to that number.`);
    }
    const trimmed = valid.slice(0, tierMaxPages);
    setIsSubmitting(true);
    try {
      const res = await apiRequest("POST", "/api/crawl", {
        seedUrls: trimmed,
        maxPages: trimmed.length,
        maxDepth: 1,
      });
      const data = await res.json();
      onCrawlStarted(data.jobId);
    } catch (err: any) {
      setError(err.message || "Failed to start crawl");
    } finally {
      setIsSubmitting(false);
    }
  };

  const parsed = mode === "list" ? parseSeedUrls(urlList) : null;

  return (
    <Card className="max-w-lg mx-auto p-6 border border-border/60">
      {isOwner && (
        <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-lg bg-gradient-to-r from-violet-50 to-indigo-50 border border-violet-200/60 dark:from-violet-950/30 dark:to-indigo-950/30 dark:border-violet-800/40">
          <Shield className="w-4 h-4 text-violet-600 dark:text-violet-400" />
          <span className="text-xs font-semibold text-violet-700 dark:text-violet-300">Owner Mode</span>
          <span className="text-xs text-violet-600/80 dark:text-violet-400/80 ml-auto">
            10,000 pages · URL upload
          </span>
        </div>
      )}
      {isPro && !isOwner && (
        <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-lg bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200/60">
          <Crown className="w-4 h-4 text-amber-500" />
          <span className="text-xs font-semibold text-amber-700">Pro Mode</span>
          <span className="text-xs text-amber-600/80 ml-auto">1,000 pages · Unlimited sitemaps</span>
        </div>
      )}

      {/* Mode toggle — owner only */}
      {isOwner && (
        <div className="grid grid-cols-2 gap-1 p-1 mb-4 rounded-lg bg-muted/50 border border-border/40">
          <button
            type="button"
            onClick={() => setMode("url")}
            className={`flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              mode === "url"
                ? "bg-background shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
            data-testid="tab-mode-url"
          >
            <Link2 className="w-3.5 h-3.5" />
            Single URL
          </button>
          <button
            type="button"
            onClick={() => setMode("list")}
            className={`flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              mode === "list"
                ? "bg-background shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
            data-testid="tab-mode-list"
          >
            <ListChecks className="w-3.5 h-3.5" />
            URL List
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        {mode === "url" ? (
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
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="url-list" className="text-sm font-medium">
                URL list <span className="text-xs text-muted-foreground font-normal">(one per line)</span>
              </Label>
              <div className="flex items-center gap-3">
                {parsed && (
                  <span className="text-xs font-mono text-muted-foreground" data-testid="text-list-count">
                    {parsed.valid.length.toLocaleString()} valid
                    {parsed.invalid.length > 0 && ` · ${parsed.invalid.length} invalid`}
                  </span>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.csv,text/plain,text/csv"
                  onChange={handleFileUpload}
                  className="hidden"
                  data-testid="input-file-upload"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  data-testid="button-upload-file"
                >
                  <Upload className="w-3.5 h-3.5" />
                  Upload .txt/.csv
                </button>
              </div>
            </div>
            <Textarea
              id="url-list"
              data-testid="input-url-list"
              placeholder={"https://example.com/page-1\nhttps://example.com/page-2\nhttps://example.com/page-3"}
              value={urlList}
              onChange={(e) => setUrlList(e.target.value)}
              rows={8}
              className="font-mono text-xs resize-y min-h-[180px]"
            />
            <p className="text-xs text-muted-foreground leading-relaxed">
              Each URL is crawled and screenshotted individually. Link discovery is disabled — the list is the
              full sitemap. Blank lines and lines starting with # are ignored. Up to {tierMaxPages.toLocaleString()} URLs.
            </p>
          </div>
        )}

        {mode === "url" && (
          <>
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
                    <span className="text-xs font-mono text-muted-foreground">{maxPages.toLocaleString()}</span>
                  </div>
                  <Slider
                    data-testid="slider-max-pages"
                    value={[maxPages]}
                    onValueChange={([v]) => setMaxPages(v)}
                    min={5}
                    max={tierMaxPages}
                    step={isOwner ? 50 : 5}
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
          </>
        )}

        {error && (
          <p className="text-sm text-destructive" data-testid="text-error">
            {error}
          </p>
        )}

        <Button
          type="submit"
          className="w-full h-11"
          disabled={
            isSubmitting ||
            (mode === "url" ? !url.trim() : !parsed || parsed.valid.length === 0)
          }
          data-testid="button-crawl"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Starting...
            </>
          ) : mode === "list" && parsed ? (
            `Generate Sitemap from ${parsed.valid.length.toLocaleString()} URL${parsed.valid.length === 1 ? "" : "s"}`
          ) : (
            "Generate Sitemap"
          )}
        </Button>
      </form>
    </Card>
  );
}
