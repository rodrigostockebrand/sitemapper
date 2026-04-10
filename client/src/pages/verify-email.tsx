import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Mail, CheckCircle2, XCircle } from "lucide-react";

export default function VerifyEmailPage() {
  const [, navigate] = useLocation();
  const { user, refreshUser, token: authToken } = useAuth();
  const { toast } = useToast();
  const [status, setStatus] = useState<"pending" | "verifying" | "success" | "error">("pending");
  const [errorMsg, setErrorMsg] = useState("");
  const [resending, setResending] = useState(false);

  // Check if there's a token in the URL (clicked from email)
  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
    const tokenParam = params.get("token");
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
  }, [navigate, refreshUser]);

  async function handleResend() {
    setResending(true);
    try {
      await apiRequest("POST", "/api/auth/resend-verification");
      toast({ title: "Verification email sent", description: "Check your inbox." });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Failed to resend", description: err.message });
    } finally {
      setResending(false);
    }
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
          Click the link in the email to verify your account. It may take a minute to arrive.
        </p>

        {authToken && (
          <Button
            variant="outline"
            onClick={handleResend}
            disabled={resending}
            className="mr-3"
          >
            {resending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Resend Email
          </Button>
        )}
        <Link href="/">
          <Button variant="ghost">Continue to App</Button>
        </Link>
      </div>
    </div>
  );
}
