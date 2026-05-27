import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

type Theme = "light" | "dark";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

const COOKIE_KEY = "vsm-theme";
const ThemeContext = createContext<ThemeContextValue | null>(null);

function readCookie(): Theme | null {
  try {
    const match = document.cookie.match(
      new RegExp("(?:^|; )" + COOKIE_KEY + "=([^;]*)"),
    );
    const v = match?.[1];
    if (v === "light" || v === "dark") return v;
  } catch {
    // Cookies blocked in some sandboxed contexts — fall through.
  }
  return null;
}

function writeCookie(theme: Theme) {
  try {
    // 1 year, site-wide, lax — purely a UI preference, no security impact.
    const oneYear = 60 * 60 * 24 * 365;
    document.cookie = `${COOKIE_KEY}=${theme}; Max-Age=${oneYear}; Path=/; SameSite=Lax`;
  } catch {
    // Best-effort: in-memory state still keeps the choice for the session.
  }
}

function initialTheme(): Theme {
  const stored = readCookie();
  if (stored) return stored;
  try {
    if (
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
    ) {
      return "dark";
    }
  } catch {
    // matchMedia missing — default to light.
  }
  return "light";
}

function applyThemeClass(theme: Theme) {
  try {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
      root.style.colorScheme = "dark";
    } else {
      root.classList.remove("dark");
      root.style.colorScheme = "light";
    }
  } catch {
    // No DOM (SSR-style) — nothing to do.
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const t = initialTheme();
    applyThemeClass(t);
    return t;
  });

  useEffect(() => {
    applyThemeClass(theme);
    writeCookie(theme);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => setThemeState(t), []);
  const toggle = useCallback(
    () => setThemeState((t) => (t === "dark" ? "light" : "dark")),
    [],
  );

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    // Safe fallback if a component renders outside the provider.
    return {
      theme: "light",
      setTheme: () => {},
      toggle: () => {},
    };
  }
  return ctx;
}
