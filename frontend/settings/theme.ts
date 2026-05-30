const THEME_KEY = "monochrome-theme";
const LEGACY_KEY = "brook-theme";
const DEFAULT_THEME = "monochrome";

export function initThemeSettings(): void {
  const saved = localStorage.getItem(THEME_KEY) ?? localStorage.getItem(LEGACY_KEY) ?? DEFAULT_THEME;
  applyTheme(saved);

  document.querySelectorAll("#theme-picker .theme-option").forEach((option) => {
    option.classList.toggle("active", option.getAttribute("data-theme") === saved);
    option.addEventListener("click", () => {
      const theme = option.getAttribute("data-theme");
      if (!theme) return;
      applyTheme(theme);
      localStorage.setItem(THEME_KEY, theme);
      localStorage.removeItem(LEGACY_KEY);
      document.querySelectorAll("#theme-picker .theme-option").forEach((el) => {
        el.classList.toggle("active", el.getAttribute("data-theme") === theme);
      });
    });
  });
}

export function applyTheme(theme: string): void {
  document.documentElement.setAttribute("data-theme", theme);
}

export function loadStoredTheme(): void {
  const saved = localStorage.getItem(THEME_KEY) ?? localStorage.getItem(LEGACY_KEY) ?? DEFAULT_THEME;
  if (localStorage.getItem(LEGACY_KEY) && !localStorage.getItem(THEME_KEY)) {
    localStorage.setItem(THEME_KEY, saved);
  }
  applyTheme(saved);
}
