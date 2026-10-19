/** Keep post-auth navigation inside routes the signed-in app can serve. */
export function authReturnPath(value: unknown) {
  if (typeof value !== 'string') return '/households';
  if (value === '/households' || value.startsWith('/households/')) return value;
  if (
    value === '/settings' ||
    value === '/attention' ||
    value.startsWith('/attention?') ||
    value.startsWith('/attention#')
  )
    return value;
  if (/^\/invite\/[A-Za-z0-9_-]+(?:[?#].*)?$/.test(value)) return value;
  return '/households';
}
