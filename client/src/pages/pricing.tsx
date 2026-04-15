import { useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Check, Crown, Zap, CreditCard } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

function PlanCard({
  name,
  price,
  features,
  highlighted,
  cta,
  onCta,
  current,
}: {
  name: string;
  price: string;
  features: string[];
  highlighted?: boolean;
  cta: string;
  onCta: () => void;
  current?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-6 flex flex-col ${
        highlighted
          ? "border-blue-300 bg-gradient-to-b from-blue-50/80 to-white shadow-lg shadow-blue-100/50 ring-1 ring-blue-200"
          : "border-gray-200 bg-white"
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        {highlighted && <Crown className="w-4 h-4 text-amber-500" />}
        <h3 className="text-lg font-bold text-gray-900">{name}</h3>
        {current && (
          <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full ml-auto">Current</span>
        )}
      </div>
      <div className="mb-4">
        <span className="text-3xl font-bold text-gray-900">{price}</span>
        {price !== "Free" && <span className="text-gray-500 text-sm">/month</span>}
      </div>
      <ul className="space-y-2.5 mb-6 flex-1">
        {features.map((f, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
            <Check className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
            {f}
          </li>
        ))}
      </ul>
      <Button
        onClick={onCta}
        disabled={current}
        className={
          highlighted
            ? "w-full bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white"
            : "w-full"
        }
        variant={highlighted ? "default" : "outline"}
      >
        {current ? "Current Plan" : cta}
      </Button>
    </div>
  );
}

export default function PricingPage() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(false);

  async function handleUpgrade() {
    if (!user) {
      window.location.hash = "#/register/pro";
      return;
    }
    setLoading(true);
    try {
      const res = await apiRequest("POST", "/api/billing/checkout");
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error(data.error || "No checkout URL returned");
      }
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message || "Failed to start checkout. Please try again.",
        variant: "destructive",
      });
      setLoading(false);
    }
  }

  async function handleManageBilling() {
    setLoading(true);
    try {
      const res = await apiRequest("POST", "/api/billing/portal");
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error(data.error || "Could not open billing portal");
      }
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message || "Failed to open billing portal.",
        variant: "destructive",
      });
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#f8f9fc]">
      <header className="bg-white border-b border-gray-100">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center">
          <Link href="/">
            <span className="text-lg font-bold text-gray-900 cursor-pointer">The Visual Sitemapper</span>
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-16">
        <div className="text-center mb-12">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Simple pricing</h1>
          <p className="text-gray-500">Choose the plan that fits your needs</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <PlanCard
            name="Free"
            price="Free"
            current={user?.tier === "free"}
            features={[
              "Up to 100 pages per crawl",
              "5 sitemaps per month",
              "Visual sitemap with screenshots",
              "Broken link detection",
              "Subfolder filtering",
            ]}
            cta="Get Started"
            onCta={() => { window.location.hash = "#/register"; }}
          />
          <PlanCard
            name="Pro"
            price="$49"
            highlighted
            current={user?.tier === "pro"}
            features={[
              "Up to 1,000 pages per crawl",
              "Unlimited sitemaps",
              "Everything in Free",
              "Priority crawl speed",
              "Export & sharing (coming soon)",
            ]}
            cta={loading ? "Redirecting..." : "Upgrade to Pro"}
            onCta={handleUpgrade}
          />
        </div>

        {user?.tier === "pro" && (
          <div className="text-center mt-8">
            <button
              onClick={handleManageBilling}
              disabled={loading}
              className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              <CreditCard className="w-4 h-4" />
              Manage billing &amp; subscription
            </button>
          </div>
        )}

        <p className="text-center text-xs text-gray-400 mt-8">
          Prices in USD. Cancel anytime. Payments processed securely via Stripe.
        </p>
      </main>
    </div>
  );
}
