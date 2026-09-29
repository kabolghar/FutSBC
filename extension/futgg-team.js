const positions=new Set(['GK','LB','CB','RB','CDM','CM','CAM','LM','RM','LW','RW','ST']);

export function futggBestURL(position){
  const mapped={LWB:'LB',RWB:'RB',CF:'ST'}[String(position||'').toUpperCase()]||String(position||'').toUpperCase();
  if(!positions.has(mapped))throw Error('No FC 27 meta ranking exists for this position.');
  return `https://www.fut.gg/players/best/cheap/${mapped.toLowerCase()}/`;
}

// Runs in a FUT.GG tab. The ranking is a meta signal, not a live price quote.
export function readFutggBest(expectedURL){
  const expected=new URL(expectedURL),actual=new URL(location.href);
  if(actual.origin!=='https://www.fut.gg'||actual.pathname!==expected.pathname)return {error:'Waiting for the requested FC 27 ranking.'};
  if(!/^Best Cheap .*EA FC 27/i.test(document.title))return {error:'FUT.GG did not load its FC 27 position ranking.'};
  const cards=[],seen=new Set();
  for(const anchor of document.querySelectorAll('section a[href^="/players/"][href*="/27-"]')){
    const url=new URL(anchor.getAttribute('href'),actual.origin);
    const match=url.pathname.match(/^\/players\/(\d+)-[^/]+\/27-(\d+)\/$/);
    const alt=anchor.querySelector('img[alt]')?.getAttribute('alt')||'';
    const rating=Number(alt.match(/ - (\d{2}) - /)?.[1]);
    const name=anchor.querySelector('h3')?.textContent?.trim();
    const assetId=Number(match?.[1]),definitionId=Number(match?.[2]);
    if(!match||!Number.isSafeInteger(assetId)||!Number.isSafeInteger(definitionId)||!Number.isInteger(rating)||rating<75||rating>99||!name||seen.has(definitionId))continue;
    const rank=Number(String(anchor.textContent||'').match(/^\s*#\s*(\d+)/)?.[1]);
    if(!Number.isInteger(rank)||rank<1||rank>30)continue;
    seen.add(definitionId);
    cards.push({assetId,definitionId,rating,name,url:url.href,metaRank:rank,source:'FUT.GG',price:null});
  }
  if(cards.length<5)return {error:'FUT.GG did not provide enough verified FC 27 meta cards.'};
  return {kind:'futgg-best',url:actual.href,checkedAt:Date.now(),cards};
}

export function selectFutggTeamPlayers(page,existingIds=[],limit=24){
  if(page?.kind!=='futgg-best'||!Number.isSafeInteger(page.checkedAt)||Date.now()-page.checkedAt>10*60_000)return [];
  const inTeam=new Set(existingIds.map(Number));
  return page.cards.filter(card=>!inTeam.has(card.assetId)&&card.metaRank<=30&&card.rating>=75).slice(0,limit);
}
