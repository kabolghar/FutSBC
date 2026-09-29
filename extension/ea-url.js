// Query official EA hosts; validate the exact app route before injecting anything.
export const EA_TAB_PATTERNS = ['https://www.ea.com/*', 'https://ea.com/*'];
export function isEaWebAppURL(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.port && !url.username && !url.password
      && ['www.ea.com', 'ea.com'].includes(url.hostname)
      && /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?ea-sports-fc\/ultimate-team\/web-app\/?$/i.test(url.pathname);
  } catch { return false; }
}
export async function findEaTabs(tabs) {
  return (await tabs.query({url: EA_TAB_PATTERNS})).filter(tab => isEaWebAppURL(tab.url));
}
