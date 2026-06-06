const THEME_KEY = "brook-theme";
const DEFAULT_THEME = "black";

export const THEMES = ["black", "white", "ocean", "purple", "forest"] as const;
export type ThemeId = (typeof THEMES)[number];

function isThemeId(theme: string): theme is ThemeId {
  return (THEMES as readonly string[]).includes(theme);
}

function readStoredThemeId(): ThemeId {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored && isThemeId(stored)) return stored;
  return DEFAULT_THEME;
}

function persistThemeId(theme: ThemeId): void {
  localStorage.setItem(THEME_KEY, theme);
}

export function initThemeSettings(): void {
  const saved = readStoredThemeId();
  applyTheme(saved);

  document.querySelectorAll("#theme-picker .theme-option").forEach((option) => {
    option.classList.toggle("active", option.getAttribute("data-theme") === saved);
    option.addEventListener("click", () => {
      const theme = option.getAttribute("data-theme");
      if (!theme || !isThemeId(theme)) return;
      applyTheme(theme);
      persistThemeId(theme);
      document.querySelectorAll("#theme-picker .theme-option").forEach((el) => {
        el.classList.toggle("active", el.getAttribute("data-theme") === theme);
      });
    });
  });
}

function applyTheme(theme: ThemeId): void {
  document.documentElement.setAttribute("data-theme", theme);
}

export function loadStoredTheme(): void {
  const saved = readStoredThemeId();
  persistThemeId(saved);
  applyTheme(saved);
}
