export const FUTBIN_MARKET_URL='https://www.futbin.com/27/market-player-list';

export function marketBands(balance){
  if(!Number.isSafeInteger(balance)||balance<150)return [];
  const ranges=[[0,5000],[5000,10000],[10000,20000],[20000,50000],[50000,100000],[100000,200000],[200000,500000],[500000,1000000],[1000000,2000000],[2000000,5000000],[5000000,10000000]];
  return ranges.filter(([low])=>low<balance).slice(-3).reverse().map(([low,high])=>`${FUTBIN_MARKET_URL}?ps_price=${low}-${high}&sort=ps_updated&order=desc`);
}

export function readFutbinMarket(expectedURL){
  const expected=new URL(expectedURL);
  const actual=new URL(location.href);
  if(actual.origin!=='https://www.futbin.com'||actual.pathname!==expected.pathname||['ps_price','sort','order'].some(key=>actual.searchParams.get(key)!==expected.searchParams.get(key)))return {error:'Waiting for the requested FC 27 market page.'};
  const body=(document.body?.innerText||document.body?.textContent||'').slice(0,600);
  if(/Just a moment|security verification|verify (?:that )?you are human|checking your browser/i.test(document.title+' '+body))return {error:'FUTBIN blocked market data. Try refreshing later.',blocked:true};
  const price=value=>{
    const match=String(value||'').replaceAll(',','').trim().match(/^(\d+(?:\.\d+)?)\s*([km])?$/i);
    if(!match)return null;
    const result=Number(match[1])*({k:1000,m:1000000}[match[2]?.toLowerCase()]||1);
    return Number.isSafeInteger(result)&&result>0?result:null;
  };
  const age=value=>{
    const match=String(value||'').trim().match(/^(\d+)\s*(secs?|mins?|hours?|days?)\s+ago$/i);
    if(!match)return null;
    return Number(match[1])*({sec:1,min:60,hour:3600,day:86400}[match[2].toLowerCase().replace(/s$/,'')]||0);
  };
  const rows=[...document.querySelectorAll('table.market-player-list-table tr.player-row')];
  if(!rows.length)return {error:'FUTBIN has not loaded the FC 27 market table.'};
  const cards=[];
  for(const row of rows){
    const anchor=row.querySelector('a.table-player-name[href^="/27/player/"]');
    const image=row.querySelector('img.playersquare-base-img');
    const assetId=Number(image?.getAttribute('src')?.match(/\/players\/(\d+)\.png/)?.[1]);
    const url=anchor?new URL(anchor.getAttribute('href'),actual.origin).href:null;
    const consolePrice=price(row.querySelector('.table-price.platform-ps-only')?.textContent);
    const eaAverage=price(row.querySelector('.table-ea-average.platform-ps-only')?.textContent);
    const updatedSeconds=age(row.querySelector('.table-updated.platform-ps-only')?.textContent);
    const trendNode=row.querySelector('.table-trend.platform-ps-only .price-diff');
    const trendMagnitude=Number(trendNode?.textContent?.replace('%','').trim());
    const trend=Number.isFinite(trendMagnitude)?trendMagnitude*(trendNode?.classList.contains('negative-color')?-1:1):null;
    const revision=row.querySelector('.table-player-revision')?.textContent.trim();
    if(url&&url.startsWith(`${actual.origin}/27/player/`)&&Number.isSafeInteger(assetId)&&assetId>0&&consolePrice&&eaAverage&&Number.isSafeInteger(updatedSeconds)&&Number.isFinite(trend))cards.push({assetId,name:anchor.textContent.trim(),url,consolePrice,eaAverage,updatedSeconds,trend,revision});
  }
  return {kind:'market',url:actual.href,checkedAt:Date.now(),rowCount:rows.length,cards};
}

export function selectMarketCards(pages,balance,now=Date.now(),limit=4){
  const found=new Map();
  const ambiguous=new Set();
  for(const page of pages){
    if(page?.kind!=='market'||!Number.isSafeInteger(page.checkedAt)||now-page.checkedAt>60_000)continue;
    for(const card of page.cards||[]){
      if(card.revision!=='Normal'||!Number.isSafeInteger(card.assetId)||!Number.isSafeInteger(card.consolePrice)||card.consolePrice<500||card.consolePrice>balance*4||!Number.isSafeInteger(card.eaAverage)||card.eaAverage<150||!Number.isSafeInteger(card.updatedSeconds)||card.updatedSeconds>600||card.updatedSeconds<0||!Number.isFinite(card.trend)||Math.abs(card.trend)>20)continue;
      const ratio=card.consolePrice/card.eaAverage;
      if(ratio<0.75||ratio>1.6)continue;
      if(ambiguous.has(card.assetId))continue;
      const previous=found.get(card.assetId);
      if(previous&&previous.url!==card.url){found.delete(card.assetId);ambiguous.add(card.assetId);continue;}
      found.set(card.assetId,{...card,checkedAt:page.checkedAt,sourceURL:page.url});
    }
  }
  return [...found.values()].sort((a,b)=>b.consolePrice-a.consolePrice||a.updatedSeconds-b.updatedSeconds).slice(0,limit);
}
