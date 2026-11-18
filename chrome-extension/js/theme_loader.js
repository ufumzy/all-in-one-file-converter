/**
 * CodeGreeks File Studio Theme Pre-loader
 * Instantly applies theme preference before first DOM paint to avoid visual flash.
 */
try {
  const preferredTheme = localStorage.getItem('codegreeks_ui_theme') || localStorage.getItem('omni_ui_theme') || localStorage.getItem('fs-theme');
  if (preferredTheme === 'light' || preferredTheme === 'dark') {
    document.documentElement.dataset.theme = preferredTheme;
  }
} catch {
  /* Storage access restricted or disabled */
}
