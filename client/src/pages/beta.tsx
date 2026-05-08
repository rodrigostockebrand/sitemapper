import { useState } from "react";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, Eye, EyeOff, Crown, Sparkles, ArrowRight } from "lucide-react";

/**
 * Beta access page \u2014 special invite-only signup that creates a Pro
 * account and bypasses Stripe billing entirely.
 *
 * Flow:
 *  1. User lands here (linked from the homepage footer).
 *  2. They enter the beta access code. On valid code, the account form
 *     unlocks. On invalid code, an inline error is shown.
 *  3. They fill in name/email/password and submit.
 *  4. Backend validates the code again and creates the user with
 *     tier="pro" and emailVerified=true.
 *  5. We log them in and route to the dashboard.
 */
export default function BetaPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const auth = useAuth();

  // Step 1 \u2014 code entry
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [codeAccepted, setCodeAccepted] = useState(false);

  // Step 2 \u2014 account fields
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);

  // Validate the code locally first \u2014 the server enforces it again on submit.
  function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault();
    const normalized = code.trim().toUpperCase();
    if (normalized !== "BETAX") {
      setCodeError("Invalid beta access code. Check with your contact and try again.");
      return;
    }
    setCodeError(null);
    setCodeAccepted(true);
  }

  async function handleCreateAccount(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      toast({ variant: "destructive", title: "Password too short", description: "Must be at least 8 characters" });
      return;
    }
    setLoading(true);
    try {
      const res = await apiRequest("POST", "/api/auth/register-beta", {
        email: email.trim(),
        password,
        name: name.trim(),
        code: code.trim(),
      });
      const data = await res.json();
      if (!data.token || !data.user) {
        throw new Error(data.error || "Beta signup failed");
      }
      // Log the user in via the auth context's login flow so state is
      // synced exactly the same as a normal login (including limits).
      await auth.login(email.trim(), password);
      toast({
        title: "Welcome to Pro \ud83c\udf89",
        description: "Your beta account is ready. Pro features unlocked.",
      });
      navigate("/dashboard");
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Beta signup failed",
        description: err?.message || "Something went wrong. Please try again.",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0e1a] flex items-center justify-center px-4 py-10" style={{ fontFamily: "'General Sans', 'Inter', sans-serif" }}>
      <div className="w-full max-w-md">
        {/* Header link back home */}
        <div className="text-center mb-8">
          <Link href="/">
            <span className="text-base font-bold text-white cursor-pointer">The Visual Sitemapper</span>
          </Link>
        </div>

        <div
          className="rounded-2xl p-7 border"
          style={{
            background: "rgba(255,255,255,0.04)",
            borderColor: "rgba(59,130,246,0.25)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.35)",
          }}
        >
          {/* Beta badge */}
          <div className="flex items-center gap-2 mb-5">
            <div
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full"
              style={{ background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.30)" }}
            >
              <Sparkles className="w-3 h-3 text-amber-400" />
              <span className="text-[11px] font-semibold text-amber-300 uppercase tracking-wider">Beta access</span>
            </div>
            <div
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full"
              style={{ background: "rgba(59,130,246,0.15)", border: "1px solid rgba(59,130,246,0.30)" }}
            >
              <Crown className="w-3 h-3 text-blue-300" />
              <span className="text-[11px] font-semibold text-blue-200">Pro included</span>
            </div>
          </div>

          {!codeAccepted ? (
            <>
              <h1 className="text-xl font-bold text-white mb-1">Enter your beta access code</h1>
              <p className="text-sm text-gray-400 mb-6">
                Beta users get a free Pro account &mdash; no billing required.
              </p>

              <form onSubmit={handleVerifyCode} className="space-y-4">
                <div>
                  <Label htmlFor="code" className="text-gray-300">Access code</Label>
                  <Input
                    id="code"
                    type="text"
                    placeholder="e.g. BETAX"
                    value={code}
                    onChange={(e) => {
                      setCode(e.target.value);
                      setCodeError(null);
                    }}
                    autoFocus
                    autoComplete="off"
                    spellCheck={false}
                    className="bg-white/5 border-white/15 text-white placeholder:text-gray-500 font-mono tracking-wider"
                    data-testid="input-beta-code"
                  />
                  {codeError && (
                    <p className="text-xs text-red-400 mt-2" data-testid="text-beta-code-error">
                      {codeError}
                    </p>
                  )}
                </div>

                <Button
                  type="submit"
                  className="w-full bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white"
                  data-testid="button-verify-code"
                >
                  Continue
                  <ArrowRight className="w-4 h-4 ml-1.5" />
                </Button>
              </form>

              <p className="text-xs text-gray-500 text-center mt-6">
                Not a beta user?{" "}
                <Link href="/register" className="text-blue-400 hover:text-blue-300 font-medium">
                  Create a free account
                </Link>
              </p>
            </>
          ) : (
            <>
              <h1 className="text-xl font-bold text-white mb-1">Create your Pro account</h1>
              <p className="text-sm text-gray-400 mb-6">
                Code accepted. Set up your beta account &mdash; Pro features unlock immediately.
              </p>

              <form onSubmit={handleCreateAccount} className="space-y-4">
                <div>
                  <Label htmlFor="name" className="text-gray-300">Name</Label>
                  <Input
                    id="name"
                    type="text"
                    placeholder="Your name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    className="bg-white/5 border-white/15 text-white placeholder:text-gray-500"
                    data-testid="input-beta-name"
                  />
                </div>

                <div>
                  <Label htmlFor="email" className="text-gray-300">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="bg-white/5 border-white/15 text-white placeholder:text-gray-500"
                    data-testid="input-beta-email"
                  />
                </div>

                <div>
                  <Label htmlFor="password" className="text-gray-300">Password</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPw ? "text" : "password"}
                      placeholder="At least 8 characters"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      minLength={8}
                      className="bg-white/5 border-white/15 text-white placeholder:text-gray-500"
                      data-testid="input-beta-password"
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200"
                      onClick={() => setShowPw(!showPw)}
                    >
                      {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white"
                  data-testid="button-beta-register"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Crown className="w-4 h-4 mr-1.5" />}
                  Create Pro Account
                </Button>
              </form>

              <p className="text-xs text-gray-500 text-center mt-6">
                Already a beta user?{" "}
                <Link href="/login" className="text-blue-400 hover:text-blue-300 font-medium">
                  Sign in
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
