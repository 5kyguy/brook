const THEME_KEY = "brook-theme";
const DEFAULT_THEME = "monochrome";

export function initThemeSettings(): void {
  const saved = localStorage.getItem(THEME_KEY) ?? DEFAULT_THEME;
  applyTheme(saved);

  document.querySelectorAll("#theme-picker .theme-option").forEach((option) => {
    option.classList.toggle(
      "active",
      option.getAttribute("data-theme") === saved,
    );
    option.addEventListener("click", () => {
      const theme = option.getAttribute("data-theme");
      if (!theme) return;
      applyTheme(theme);
      localStorage.setItem(THEME_KEY, theme);
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
  applyTheme(localStorage.getItem(THEME_KEY) ?? DEFAULT_THEME);
}
