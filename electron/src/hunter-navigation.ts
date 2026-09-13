const explicitScheme = /^[a-z][a-z\d+.-]*:/i;
const webScheme = /^https?:\/\//i;
const hostLike = /^(?:localhost|\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-f:]+\]|(?:[\p{L}\p{N}-]+\.)+[\p{L}]{2,})(?::\d+)?(?:[/?#]|$)/iu;

function validatedWebUrl(value: string): string {
  const parsed = new URL(value);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Hunter supports only HTTP and HTTPS URLs.');
  }
  return parsed.toString();
}

export function resolveHunterInput(rawInput: string): string {
  const value = rawInput.trim();
  if (!value) throw new Error('Enter a URL or search term.');

  if (webScheme.test(value)) return validatedWebUrl(value);
  if (hostLike.test(value)) return validatedWebUrl(`https://${value}`);
  if (explicitScheme.test(value)) throw new Error('Hunter supports only HTTP and HTTPS URLs.');

  const search = new URL('https://www.google.com/search');
  search.searchParams.set('q', value);
  return search.toString();
}
