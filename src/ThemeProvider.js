import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

const ThemeContext = createContext(null);

const THEME_KEY = "theme";

export const THEMES = [
  { value: "rose", label: "Rose" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "emerald", label: "Emerald" },
];

const applyThemeToDOM = (theme) => {
  document.documentElement.setAttribute("data-theme", theme);
};

export function ThemeProvider({ children, defaultTheme = "rose" }) {
  const [theme, setTheme] = useState(() => localStorage.getItem(THEME_KEY) || defaultTheme);

  useEffect(() => {
    applyThemeToDOM(theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const value = useMemo(() => ({ theme, setTheme, themes: THEMES }), [theme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
