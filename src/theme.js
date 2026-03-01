// src/theme.js
export const THEME_STORAGE_KEY = "theme";

export const THEMES = [
  { value: "rose", label: "Rose" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "emerald", label: "Emerald" },
];

export const getInitialTheme = (fallback = "rose") => {
  return localStorage.getItem(THEME_STORAGE_KEY) || fallback;
};

export const applyTheme = (theme) => {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(THEME_STORAGE_KEY, theme);
};
