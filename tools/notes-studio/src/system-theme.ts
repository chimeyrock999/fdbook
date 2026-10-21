// The site's dark tokens (styles/notes-theme.css) and the editor's key off a
// `.dark` class, which next-themes sets on the site. The Studio follows the
// system preference, so `.dark` on <html> mirrors it.
export function followSystemTheme(root: HTMLElement = document.documentElement) {
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  const apply = () => { root.classList.toggle('dark', query.matches); };
  apply();
  query.addEventListener('change', apply);
  return () => { query.removeEventListener('change', apply); };
}
