import { useState, useEffect } from "react";
import { useLocation, Link, useParams } from "wouter";
import { useAuth } from "@/lib/auth";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Mail, CheckCircle2, XCircle, LogOut } from "lucide-react";

const RESEND_COOLDOWN_SECONDS = 30;

export default function VerifyEmailPage() {
  const [, navigate] = useLocation();
  const params = useParams<{ token?: string }>();
  const { user, refreshUser, token: authToken, logout } = useAuth();
  const { toast } = useToast();
  const [status, setStatus] = useState<"pending" | "verifying" | "success" | "error">("pending");
  const [errorMsg, setErrorMsg] = useState("");
  const [resending, setResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resendCount, setResendCount] = useState(0);

  // Tick down the cooldown each second
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  // Check if there's a token in the URL (clicked from email)
  useEffect(() => {
    // Support both /verify/:token (new) and /verify?token=x (legacy)
    const queryParams = new URLSearchParams(window.location.hash.split("?")[1] || "");
    const tokenParam = params.token || queryParams.get("token");
    if (tokenParam) {
      setStatus("verifying");
      const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";
      fetch(`${API_BASE}/api/auth/verify-email?token=${tokenParam}`)
        .then(async (res) => {
          const data = await res.json();
          if (res.ok) {
            setStatus("success");
            // If we got a new token + user, update auth state
            if (data.token) {
              try {
                localStorage.setItem("sitemapper_token", data.token);
              } catch {}
            }
            await refreshUser();
            setTimeout(() => navigate("/"), 2000);
          } else {
            setStatus("error");
            setErrorMsg(data.error || "Verification failed");
          }
        })
        .catch(() => {
          setStatus("error");
          setErrorMsg("Network error. Please try again.");
        });
    }
  }, [navigate, refreshUser, params.token]);

  async function handleResend() {
    if (resending || resendCooldown > 0) return;
    setResending(true);
    try {
      await apiRequest("POST", "/api/auth/resend-verification");
      setResendCount((n) => n + 1);
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
      toast({
        title: "Verification email sent",
        description: `We sent a new link to ${user?.email || "your email"}. Check your inbox (and spam).`,
      });
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Failed to resend",
        description: err.message || "Please try again in a moment.",
      });
    } finally {
      setResending(false);
    }
  }

  function handleLogout() {
    logout();
    navigate("/login");
  }

  if (status === "verifying") {
    return (
      <div className="min-h-screen bg-[#f8f9fc] flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500 mx-auto mb-4" />
          <p className="text-gray-600">Verifying your email...</p>
        </div>
      </div>
    );
  }

  if (status === "success") {
    return (
      <div className="min-h-screen bg-[#f8f9fc] flex items-center justify-center">
        <div className="text-center max-w-sm">
          <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-gray-900 mb-2">Email Verified</h1>
          <p className="text-gray-500 mb-6">Your account is all set. Redirecting you to the app...</p>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="min-h-screen bg-[#f8f9fc] flex items-center justify-center">
        <div className="text-center max-w-sm">
          <XCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-gray-900 mb-2">Verification Failed</h1>
          <p className="text-gray-500 mb-6">{errorMsg}</p>
          <Link href="/">
            <Button variant="outline">Back to Home</Button>
          </Link>
        </div>
      </div>
    );
  }

  // Default: show "check your email" screen (after registration)
  const cooldownActive = resendCooldown > 0;
  const resendLabel = resending
    ? "Sending..."
    : cooldownActive
      ? `Resend in ${resendCooldown}s`
      : resendCount > 0
        ? "Send again"
        : "Didn't get it? Send again";

  return (
    <div className="min-h-screen bg-[#f8f9fc] flex items-center justify-center px-4">
      <div className="text-center max-w-sm">
        <div className="w-16 h-16 rounded-full bg-blue-50 flex items-center justify-center mx-auto mb-6">
          <Mail className="w-8 h-8 text-blue-500" />
        </div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">Check your email</h1>
        <p className="text-gray-500 mb-2">
          We sent a verification link to{" "}
          <span className="font-medium text-gray-700">{user?.email || "your email"}</span>.
        </p>
        <p className="text-sm text-gray-400 mb-8">
          Click the link in the email to verify your account. It may take a minute to arrive
          — don't forget to check your spam folder.
        </p>

        {authToken && (
          <div className="flex flex-col items-center gap-3 mb-6">
            <Button
              variant="outline"
              onClick={handleResend}
              disabled={resending || cooldownActive}
              data-testid="button-resend-verification"
              className="min-w-[200px]"
            >
              {resending ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Mail className="w-4 h-4 mr-2" />
              )}
              {resendLabel}
            </Button>
            {resendCount > 0 && !cooldownActive && (
              <p className="text-xs text-emerald-600" data-testid="text-resend-sent">
                Sent {resendCount === 1 ? "a new link" : `${resendCount} new links`}. Still no email? Check spam or try again.
              </p>
            )}
          </div>
        )}

        <div className="flex items-center justify-center gap-4 text-sm">
          <Link href="/">
            <Button variant="ghost" data-testid="button-continue-app">Continue to App</Button>
          </Link>
          {authToken && (
            <button
              type="button"
              onClick={handleLogout}
              data-testid="button-logout"
              className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              <LogOut className="w-3 h-3" />
              Log out
            </button>
          )}
        </div>

        {authToken && (
          <p className="text-xs text-gray-400 mt-6">
            Wrong email address? Log out and register again with the correct one.
          </p>
        )}
      </div>
    </div>
  );
}
