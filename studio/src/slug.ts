// Kebab-case ASCII, as graph ids and asset names use it: Vietnamese marks
// dropped, anything else becomes a dash.
export function slugify(text: string) {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
