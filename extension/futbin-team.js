export const FUTBIN_PLAYERS_URL='https://www.futbin.com/27/players';

export function teamPlayerPages(budget){
  const ranges=[[0,5000],[5000,10000],[10000,20000],[20000,50000],[50000,100000],[100000,250000],[250000,500000],[500000,1000000]];
  if(!Number.isSafeInteger(budget)||budget<500)return [];
  const eligible=ranges.filter(([low])=>low<budget);
  const chosen=[eligible[0],...eligible.slice(1).slice(-3)].filter(Boolean);
  return chosen.flatMap(([low,high])=>Array.from({length:low===0?3:1},(_,index)=>`${FUTBIN_PLAYERS_URL}?page=${index+1}&ps_price=${low}-${high}`));
}

// Executed in the FUTBIN tab. Rejects incomplete, unrelated and verification pages.
export function readFutbinTeamPlayers(expectedURL){
  const expected=new URL(expectedURL),actual=new URL(location.href);
  const parameter=(url,key)=>url.searchParams.get(key)||(key==='page'?'1':null);
  if(actual.origin!=='https://www.futbin.com'||actual.pathname!==expected.pathname||['page','ps_price'].some(key=>parameter(actual,key)!==parameter(expected,key)))return {error:'Waiting for the requested FC 27 player page.'};
  const body=(document.body?.innerText||'').slice(0,600);
  if(/Just a moment|security verification|verify (?:that )?you are human|checking your browser/i.test(`${document.title} ${body}`))return {error:'FUTBIN player data requires browser verification.',blocked:true};
  const parsePrice=value=>{
    const match=String(value||'').replaceAll(',','').trim().match(/^(\d+(?:\.\d+)?)\s*([KM])?$/i);
    if(!match)return null;
    const result=Number(match[1])*({K:1000,M:1000000}[match[2]?.toUpperCase()]||1);
    return Number.isSafeInteger(result)&&result>=500?result:null;
  };
  const tables=[...document.querySelectorAll('table')];
  const headers=element=>[...element.querySelectorAll('thead th')].length?[...element.querySelectorAll('thead th')]:[...element.querySelectorAll('th')];
  const table=tables.find(element=>{
    const heads=headers(element).map(node=>node.textContent.trim().toUpperCase());
    return heads.some(value=>value==='POS'||value==='POSITION')&&heads.some(value=>value==='PRICE'||value.includes('PRICE'))&&heads.some(value=>value.includes('FUTBIN')&&value.includes('RATING'));
  });
  if(!table)return {error:'FUTBIN has not loaded a supported FC 27 player table.'};
  const headings=headers(table).map(node=>node.textContent.trim().toUpperCase());
  const column=pattern=>headings.findIndex(value=>pattern.test(value));
  const indexes={rating:column(/^RAT$|^OVR$/),position:column(/^POS$|^POSITION$/),price:column(/^PRICE$|^PS PRICE$|^CONSOLE PRICE$/),fit:column(/FUTBIN\s*RATING/),popularity:column(/^POP$|^POPULARITY$/)};
  if(Object.values(indexes).slice(0,4).some(index=>index<0))return {error:'FUTBIN player columns changed; no suggestions were imported.'};
  const rows=[...table.querySelectorAll('tbody tr')].length?[...table.querySelectorAll('tbody tr')]:[...table.querySelectorAll('tr')].filter(row=>row.querySelector('td'));
  const cards=[];
  for(const row of rows){
    const cells=[...row.querySelectorAll('td')],anchor=row.querySelector('a[href^="/27/player/"]');
    const image=row.querySelector('img[src*="/players/"]');
    const assetId=Number(image?.getAttribute('src')?.match(/\/players\/(\d+)\.(?:png|webp)/i)?.[1]);
    const url=anchor?new URL(anchor.getAttribute('href'),actual.origin).href:null;
    const rating=Number(cells[indexes.rating]?.textContent.trim());
    const positions=(cells[indexes.position]?.textContent||'').toUpperCase().match(/\b(?:GK|RWB|RB|CB|LB|LWB|CDM|RM|CM|LM|CAM|CF|RW|ST|LW)\b/g)||[];
    const priceCell=cells[indexes.price];
    const price=parsePrice(priceCell?.querySelector?.('.platform-ps-only')?.textContent||priceCell?.textContent?.split(/\n|\s{2,}/)[0]);
    const fit=Number(cells[indexes.fit]?.textContent.trim());
    const popularity=Number(cells[indexes.popularity]?.textContent.trim().replaceAll(',',''));
    const firstCell=cells[0]?.textContent||'';
    const revision=row.querySelector('.table-player-revision')?.textContent?.trim()||(/\bNormal\b/i.test(firstCell)?'Normal':null);
    if(!url?.startsWith(`${actual.origin}/27/player/`)||!Number.isSafeInteger(assetId)||assetId<1||!Number.isInteger(rating)||rating<40||rating>99||!positions.length||!price||!Number.isFinite(fit)||fit<0||fit>100||revision!=='Normal')continue;
    cards.push({assetId,name:anchor.textContent.trim(),url,rating,positions:[...new Set(positions)],price,futbinRating:fit,popularity:Number.isSafeInteger(popularity)&&popularity>=0?popularity:null,revision});
  }
  if(!cards.length)return {error:'FUTBIN player rows did not contain verifiable normal cards.'};
  return {kind:'team-players',url:actual.href,checkedAt:Date.now(),rowCount:rows.length,cards};
}

export function selectTeamPlayers(pages,position,budget,existingIds=[],limit=48,now=Date.now()){
  const inTeam=new Set(existingIds.map(Number)),found=new Map(),ambiguous=new Set();
  for(const page of pages||[]){
    if(page?.kind!=='team-players'||!Number.isSafeInteger(page.checkedAt)||now-page.checkedAt>10*60_000)continue;
    for(const card of page.cards||[]){
      if(card.revision!=='Normal'||!card.positions?.includes(position)||!Number.isSafeInteger(card.assetId)||inTeam.has(card.assetId)||!Number.isSafeInteger(card.price)||card.price<500||card.price>budget||!Number.isInteger(card.rating)||card.rating<75||!Number.isFinite(card.futbinRating)||card.futbinRating<75)continue;
      if(ambiguous.has(card.assetId))continue;
      const prior=found.get(card.assetId);
      if(prior&&prior.url!==card.url){found.delete(card.assetId);ambiguous.add(card.assetId);continue;}
      found.set(card.assetId,card);
    }
  }
  const sorted=[...found.values()].sort((a,b)=>b.futbinRating-a.futbinRating||b.rating-a.rating||a.price-b.price);
  // Reserve room for low-cost fits, rather than filling every slot with the highest-rated cards.
  const affordable=[...sorted].sort((a,b)=>a.price-b.price||b.futbinRating-a.futbinRating).slice(0,Math.ceil(limit/3));
  return [...new Map([...affordable,...sorted].map(card=>[card.assetId,card])).values()].slice(0,limit);
}
