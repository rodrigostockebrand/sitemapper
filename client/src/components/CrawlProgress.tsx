import { useEffect, useState, useRef, useCallback } from "react";
import { Progress } from "@/components/ui/progress";
import { Loader2, Globe, Camera, CheckCircle2, AlertCircle } from "lucide-react";
import type { CrawlJob } from "@shared/schema";
import { API_BASE } from "@/lib/api";
import { getAuthToken } from "@/lib/auth";

// Build fetch init that includes the user's bearer token when logged in. The
// backend's crawl detail endpoints reject other users' jobs, so the polling
// requests need to identify the caller — otherwise an owner-locked job looks
// like a 404 and progress is stuck at 0%.
function authedFetchInit(): RequestInit {
  const token = getAuthToken();
  return token ? { headers: { Authorization: `Bearer ${token}` } } : {};
}

interface CrawlProgressProps {
  jobId: string;
  onComplete: (data: CrawlJob) => void;
}

export function CrawlProgress({ jobId, onComplete }: CrawlProgressProps) {
  const [status, setStatus] = useState<string>("crawling");
  const [progress, setProgress] = useState(0);
  const [pagesProcessed, setPagesProcessed] = useState(0);
  const [screenshotsProcessed, setScreenshotsProcessed] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const completedRef = useRef(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchFullData = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/crawl/${jobId}/full`, authedFetchInit());
      if (!res.ok) throw new Error("Failed to fetch results");
      const fullData = await res.json();
      onComplete(fullData);
    } catch (err) {
      console.error("Failed to fetch full data:", err);
      // Retry once after short delay
      setTimeout(async () => {
        try {
          const res = await fetch(`${API_BASE}/api/crawl/${jobId}/full`, authedFetchInit());
          const fullData = await res.json();
          onComplete(fullData);
        } catch {
          setStatus("error");
          setErrorMessage("Failed to load completed results. Please try again.");
        }
      }, 2000);
    }
  }, [jobId, onComplete]);

  useEffect(() => {
    // Use HTTP polling for reliable progress updates (works through proxy)
    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/crawl/${jobId}`, authedFetchInit());
        if (!res.ok) return;
        const data = await res.json();

        if (data.status) setStatus(data.status);
        if (data.progress !== undefined) setProgress(data.progress);
        if (data.pagesProcessed !== undefined) setPagesProcessed(data.pagesProcessed);
        if (data.screenshotsProcessed !== undefined) setScreenshotsProcessed(data.screenshotsProcessed);
        if (data.pages) setTotalPages(data.pages.length);

        if (data.status === "complete" && !completedRef.current) {
          completedRef.current = true;
          if (pollRef.current) clearInterval(pollRef.current);
          fetchFullData();
        }

        if (data.status === "error") {
          if (pollRef.current) clearInterval(pollRef.current);
          setErrorMessage(data.errorMessage || "An error occurred");
        }
      } catch (err) {
        // Silently retry on next poll
      }
    };

    // Poll immediately, then every 2 seconds
    poll();
    pollRef.current = setInterval(poll, 2000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [jobId, fetchFullData]);

  const statusIcon = () => {
    switch (status) {
      case "crawling":
        return <Globe className="w-5 h-5 text-primary animate-pulse" />;
      case "screenshotting":
        return <Camera className="w-5 h-5 text-primary animate-pulse" />;
      case "complete":
        return <CheckCircle2 className="w-5 h-5 text-green-500" />;
      case "error":
        return <AlertCircle className="w-5 h-5 text-destructive" />;
      default:
        return <Loader2 className="w-5 h-5 text-primary animate-spin" />;
    }
  };

  const statusText = () => {
    switch (status) {
      case "crawling":
        return `Discovering pages... (${pagesProcessed} found)`;
      case "screenshotting": {
        // Clamp display so a brief overshoot (parallel batch race) doesn't show
        // "1186 of 1000 — 111% complete"
        const safeTotal = Math.max(totalPages, 1);
        const safeDone = Math.min(screenshotsProcessed, safeTotal);
        return `Capturing screenshots... (${safeDone} of ${safeTotal})`;
      }
      case "complete":
        return `Complete — ${totalPages} pages mapped`;
      case "error":
        return errorMessage || "An error occurred during crawling";
      default:
        return "Initializing...";
    }
  };

  return (
    <div className="max-w-md mx-auto px-4 py-24 text-center">
      <div className="flex flex-col items-center gap-5">
        <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
          {statusIcon()}
        </div>
        <div className="space-y-3 w-full">
          <p className="text-sm font-medium" data-testid="text-status">
            {statusText()}
          </p>
          <Progress value={progress} className="h-2" data-testid="progress-bar" />
          <p className="text-xs text-muted-foreground">
            {Math.min(progress, 100)}% complete
          </p>
        </div>
      </div>
    </div>
  );
}
