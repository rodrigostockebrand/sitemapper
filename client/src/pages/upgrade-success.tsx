import { useEffect } from "react";
import { useLocation } from "wouter";
import { CheckCircle, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/lib/auth";

export default function UpgradeSuccessPage() {
  const [, navigate] = useLocation();
  const { user, refreshUser } = useAuth();

  useEffect(() => {
    // Refresh user data so tier updates from webhook are picked up
    refreshUser?.();
  }, []);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardContent className="pt-8 pb-8 text-center space-y-6">
          <div className="flex justify-center">
            <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <CheckCircle className="w-10 h-10 text-green-600 dark:text-green-400" />
            </div>
          </div>

          <div className="space-y-2">
            <h1 className="text-2xl font-bold tracking-tight">
              Welcome to Pro!
            </h1>
            <p className="text-muted-foreground">
              Your account has been upgraded. You now have access to 1,000 pages
              per sitemap and unlimited sitemaps.
            </p>
          </div>

          <Button
            onClick={() => navigate("/dashboard")}
            className="w-full"
            data-testid="button-go-dashboard"
          >
            Go to Dashboard
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
