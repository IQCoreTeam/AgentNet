import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

// Languages AgentNet ships onboarding / settings copy for. To add a locale (e.g. "ru"):
// add it here, extend LANGS, teach detectLang() its tag, and fill that key in the t({...})
// calls that already carry en + ko. Missing keys fall back to English, so a partial locale
// still renders.
export type Lang = "en" | "ko";

export const LANGS: { code: Lang; label: string }[] = [
  { code: "en", label: "English" },
  { code: "ko", label: "한국어" },
];

const STORE_KEY = "agentnet.lang";

// Default language: a stored user choice wins; otherwise follow the device/browser language
// (navigator.language + the ordered navigator.languages), otherwise English. Read once at
// provider init so first paint is already in the right language, no flash.
function detectLang(): Lang {
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved === "en" || saved === "ko") return saved;
  } catch {
    /* localStorage may be unavailable; fall through to device detection */
  }
  try {
    const tags = [navigator.language, ...(navigator.languages ?? [])].filter(Boolean);
    if (tags.some((tag) => tag.toLowerCase().startsWith("ko"))) return "ko";
  } catch {
    /* no navigator; default below */
  }
  return "en";
}

type LangContextValue = { lang: Lang; setLang: (lang: Lang) => void };
const LangContext = createContext<LangContextValue | null>(null);

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectLang);
  const value = useMemo<LangContextValue>(
    () => ({
      lang,
      setLang: (next) => {
        setLangState(next);
        try {
          localStorage.setItem(STORE_KEY, next);
        } catch {
          /* persistence is best-effort */
        }
      },
    }),
    [lang],
  );
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang(): LangContextValue {
  const value = useContext(LangContext);
  if (!value) throw new Error("useLang must be used within LangProvider");
  return value;
}

// Inline, co-located translation. `t({ en: "...", ko: "..." })` returns the active language's
// string, falling back to English when a locale is missing. Keeps each string next to the JSX
// that uses it (no central key registry to drift), and adding a language is one more key.
export type Msg = Partial<Record<Lang, string>> & { en: string };

export function useT(): (m: Msg) => string {
  const { lang } = useLang();
  return (m: Msg) => m[lang] ?? m.en;
}
