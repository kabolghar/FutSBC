export function cardArtPage(assetId,definitionId){
  if(!Number.isSafeInteger(assetId)||assetId<1||!Number.isSafeInteger(definitionId)||definitionId<1||definitionId%0x1000000!==assetId)throw Error('A verified EA card ID is needed for artwork.');
  return `https://www.fut.gg/players/${assetId}/27-${definitionId}/`;
}

export function readCardArt(html,assetId,definitionId,pageURL){
  const requested=cardArtPage(assetId,definitionId);
  const page=new URL(pageURL);
  if(page.origin!=='https://www.fut.gg'||!new RegExp(`^/players/${assetId}(?:-[^/]+)?/27-${definitionId}/$`).test(page.pathname))throw Error('The card page did not match the EA item.');
  const pattern=new RegExp(`https://game-assets\\.fut\\.gg/(?:cdn-cgi/image/[^"'\\s<>]+/)?2027/player-item-social-small/27-${definitionId}\\.[a-f0-9]{32,128}\\.webp`);
  const imageURL=String(html||'').match(pattern)?.[0]?.replaceAll('&amp;','&');
  if(!imageURL)throw Error('An exact FC 27 card image was not published for this item.');
  return {assetId,definitionId,imageURL,pageURL:page.href,source:'FUT.GG FC 27 card image'};
}
