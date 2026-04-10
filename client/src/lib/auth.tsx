import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { apiRequest } from "./queryClient";

// Types matching SafeUser on the backend
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  tier: "free" | "pro";
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  createdAt: string;
}

export interface AuthLimits {
  maxPages: number;
  maxDepth: number;
  monthlyCredits: number;
}

interface AuthState {
  user: AuthUser | null;
  token: string | null;
  limits: AuthLimits | null;
  crawlsThisMonth: number;
  crawlsRemaining: number;
  loading: boolean;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Safely get/set token from storage (fails silently in sandboxed iframes)
function getStoredToken(): string | null {
  try {
    return localStorage.getItem("sitemapper_token");
  } catch {
    return null;
  }
}

function setStoredToken(token: string | null) {
  try {
    if (token) {
      localStorage.setItem("sitemapper_token", token);
    } else {
      localStorage.removeItem("sitemapper_token");
    }
  } catch {
    // localStorage blocked — token lives in memory only
  }
}

// Global token for apiRequest to use
let currentToken: string | null = getStoredToken();

/** Get the current auth token (used by queryClient) */
export function getAuthToken(): string | null {
  return currentToken;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    token: getStoredToken(),
    limits: null,
    crawlsThisMonth: 0,
    crawlsRemaining: Infinity,
    loading: true,
  });

  const setAuth = useCallback((token: string | null, user: AuthUser | null, limits?: AuthLimits | null, crawlsThisMonth?: number, crawlsRemaining?: number) => {
    currentToken = token;
    setStoredToken(token);
    setState({
      user,
      token,
      limits: limits || null,
      crawlsThisMonth: crawlsThisMonth ?? 0,
      crawlsRemaining: crawlsRemaining ?? Infinity,
      loading: false,
    });
  }, []);

  // On mount, check if stored token is still valid
  useEffect(() => {
    const storedToken = getStoredToken();
    if (!storedToken) {
      setState((s) => ({ ...s, loading: false }));
      return;
    }

    currentToken = storedToken;
    fetch(`${"__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__"}/api/auth/me`, {
      headers: { Authorization: `Bearer ${storedToken}` },
    })
      .then(async (res) => {
        if (res.ok) {
          const data = await res.json();
          setAuth(storedToken, data.user, data.limits, data.crawlsThisMonth, data.crawlsRemaining);
        } else {
          setAuth(null, null);
        }
      })
      .catch(() => setAuth(null, null));
  }, [setAuth]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await apiRequest("POST", "/api/auth/login", { email, password });
    const data = await res.json();
    setAuth(data.token, data.user);
    // Immediately fetch full user data with limits
    try {
      currentToken = data.token;
      const meRes = await fetch(`${"__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__"}/api/auth/me`, {
        headers: { Authorization: `Bearer ${data.token}` },
      });
      if (meRes.ok) {
        const meData = await meRes.json();
        setAuth(data.token, meData.user, meData.limits, meData.crawlsThisMonth, meData.crawlsRemaining);
      }
    } catch {}
  }, [setAuth]);

  const register = useCallback(async (email: string, password: string, name: string) => {
    const res = await apiRequest("POST", "/api/auth/register", { email, password, name });
    const data = await res.json();
    setAuth(data.token, data.user);
  }, [setAuth]);

  const logout = useCallback(() => {
    setAuth(null, null);
  }, [setAuth]);

  const refreshUser = useCallback(async () => {
    if (!currentToken) return;
    try {
      const res = await fetch(`${"__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__"}/api/auth/me`, {
        headers: { Authorization: `Bearer ${currentToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setAuth(currentToken, data.user, data.limits, data.crawlsThisMonth, data.crawlsRemaining);
      }
    } catch {}
  }, [setAuth]);

  return (
    <AuthContext.Provider value={{ ...state, login, register, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
}
