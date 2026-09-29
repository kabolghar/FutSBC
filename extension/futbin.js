// Self-contained: runs in FUTBIN's isolated extension world, reading rendered DOM only.
export function readFutbin(lookupId = null, expectedURL = null) {
  if(expectedURL) {
    const normalize=value=>decodeURI(new URL(value).pathname).replace(/\/$/,'');
    if(location.origin!=='https://www.futbin.com' || normalize(location.href)!==normalize(expectedURL)) return {error:'Waiting for the requested page to replace the previous document.'};
  }
  if (lookupId !== null) {
    const links = [...document.querySelectorAll('a[href]')].map(a => a.href).filter(href => {
      try { return new URL(href).origin === 'https://www.futbin.com'; } catch { return false; }
    });
    const completed = links.find(href => {
      const match = new URL(href).pathname.match(/^\/27\/squad-building-challenges\/[^/]+\/(\d+)\/[^/]+\/?$/);
      return match && Number(match[1]) === lookupId;
    });
    if (completed) return {kind:'lookup', url:completed};
    const group = links.find(href => /^\/27\/squad-building-challenge\/\d+\/?$/.test(new URL(href).pathname));
    if (group && location.pathname.startsWith('/27/squad-building-challenge/ea/')) return {kind:'lookup', groupURL:group};
  }
  const price = value => {
    const m=String(value??'').trim().replaceAll(',','').match(/^(\d+(?:\.\d+)?)\s*([km])?$/i);
    if(!m) return null;
    const n=Number(m[1])*({k:1000,m:1000000}[m[2]?.toLowerCase()]||1);
    return Number.isSafeInteger(n)&&n>0?n:null;
  };
  const text = (node,selector)=>node.querySelector(selector)?.textContent.trim()||'';
  const rows=[...document.querySelectorAll('.sbc-solution-row')];
  if(rows.length) {
    const match=location.pathname.match(/^\/27\/squad-building-challenges\/[^/]+\/(\d+)\//);
    if(!match) return {error:'Not an FC 27 completed-challenge page.'};
    const solutions=rows.map(row=>({url:row.querySelector('.sbc-solution-link')?.href,consolePrice:price(text(row,'.sbc-solution-ps-price')),title:text(row,'.sbc-solution-title')})).filter(s=>s.url&&s.consolePrice);
    if(!solutions.length) return {error:'Waiting for console prices in the completed-challenge table.'};
    return {kind:'comparison',challengeId:Number(match[1]),name:text(document,'h1'),solutions,checkedAt:Date.now(),rowCount:rows.length,unpricedCount:rows.length-solutions.length};
  }
  const cards=[...document.querySelectorAll('.playercard-field[id^="cardlid"]')];
  let embeddedResult=null;
  // FUTBIN embeds the full squad as JSON for React. In some browsers the
  // visual cards exist later than this data (or never appear in the DOM).
  if(lookupId === null && /^\/27\/squad\/\d+\/sbc\/?$/.test(location.pathname)) {
    const script=document.querySelector('script[data-react-data]');
    if(script?.textContent) {
      const readEmbedded=()=>{
      let data;
      try { data=JSON.parse(script.textContent); }
      catch { return {error:'FUTBIN squad data is present but could not be decoded.'}; }
      const link=[...document.querySelectorAll('a[href]')].find(a=>{
        try { const u=new URL(a.href,location.href);return u.origin===location.origin&&/^\/27\/squad-building-challenges\/[^/]+\/\d+\//.test(u.pathname); }
        catch { return false; }
      });
      const challengeId=Number(link?.href.match(/challenges\/[^/]+\/(\d+)\//)?.[1]);
      if(!challengeId) return {error:'The squad page has no matching SBC challenge link.'};
      const formation=data?.sbcChallengeRequirementData?.formation?.positions;
      const entries=data?.squadData?.squad;
      if(!Array.isArray(formation)||!Array.isArray(entries)) return {error:'Waiting for FUTBIN squad data to finish loading.'};
      const slotPositions=new Map();
      for(let i=0;i<formation.length-1;i++) if(/^cardlid\d+$/.test(formation[i]?.value||'')) slotPositions.set(formation[i].value,formation[i+1]?.value||'');
      const slots=new Set(slotPositions.keys());
      const countRule=data.sbcChallengeRequirementData.requirements?.find(rule=>/\.PlayerCount$/.test(rule?.type||'')&&/\.Exactly$/.test(rule?.operator?.type||''));
      const requiredPlayers=Number.isSafeInteger(countRule?.value)&&countRule.value>0&&countRule.value<=slots.size?countRule.value:slots.size;
      const players=[];
      for(let i=0;i<entries.length;i++) {
        const slot=entries[i]?.value;
        if(!slots.has(slot)) continue;
        const item=entries[i+1];
        if(!item || item.value) return {error:`Waiting for a player in ${slot}.`,incompleteSquad:true,expectedSlots:requiredPlayers};
        const baseURL=item.playerImage?.fixed?.url?.image1x||'';
        const cardURL=item.statsCard?.cardImage?.fixed?.url?.image1x||'';
        const id=Number(item.id?.playerCardId?.value);
        const attributes=['BasePace','BaseShooting','BasePassing','BaseDribbling','BaseDefending','BasePhysicality'].map(key=>Number(item.playerStats?.[key]));
        players.push({futbinSlot:Number(slot.slice(7)),slotPosition:slotPositions.get(slot),name:item.statsCard?.title||item.playerName||'',baseId:Number(baseURL.match(/\/players\/(\d+)\.png/)?.[1]),rarity:Number(cardURL.match(/\/hd\/(\d+)[_.]/)?.[1]),rating:Number(item.playerRating),position:item.position?.value||'',clubId:Number(item.clubId?.value)||null,leagueId:Number(item.leagueId?.value)||null,nationId:Number(item.nationId?.value)||null,attributes:attributes.every(value=>Number.isSafeInteger(value)&&value>=0&&value<=99)?attributes:null,price:Number(item.price?.ps?.price),url:Number.isSafeInteger(id)&&id>0?`${location.origin}/27/player/${id}`:null});
      }
      if(players.length!==requiredPlayers || !players.length) return {error:`Waiting for the complete squad (${players.length}/${requiredPlayers} players loaded).`,incompleteSquad:true,expectedSlots:requiredPlayers};
      if(players.some(p=>!Number.isSafeInteger(p.baseId)||p.baseId<1||!Number.isInteger(p.rarity)||p.rarity<0||!Number.isInteger(p.rating)||p.rating<1||!p.name||!p.position)) return {error:'FUTBIN card identities could not be read from embedded squad data.'};
      if(players.some(p=>!Number.isSafeInteger(p.price)||p.price<1)) return {error:'Waiting for console player prices in embedded squad data.'};
      return {kind:'squad',year:27,market:'console',name:link.textContent.trim()||data.sbcChallengeRequirementData.challengeName||'SBC squad',challengeId,requiredPlayers,players,total:players.reduce((sum,p)=>sum+p.price,0),url:location.href,checkedAt:Date.now()};
      };
      embeddedResult=readEmbedded();
      if(embeddedResult.kind==='squad')return embeddedResult;
    }
  }
  if(cards.length && lookupId === null) {
    const link=[...document.querySelectorAll('a')].find(a=>/^\/27\/squad-building-challenges\/[^/]+\/\d+\//.test(new URL(a.href).pathname));
    const challengeId=Number(link?.href.match(/challenges\/[^/]+\/(\d+)\//)?.[1]);
    const players=cards.map(node=>{
      const card=node.querySelector('.playercard-27');
      if(!card) return null;
      const base=card.querySelector('.playercard-27-base-img')?.getAttribute('src')||'';
      const bg=card.querySelector('.playercard-27-bg')?.getAttribute('src')||'';
      return {futbinSlot:Number(node.id.replace('cardlid','')),name:card.getAttribute('title')||text(card,'.playercard-27-name'),baseId:Number(base.match(/\/players\/(\d+)\.png/)?.[1]),rarity:Number(bg.match(/\/hd\/(\d+)[_.]/)?.[1]),rating:Number(text(card,'.playercard-27-rating')),position:text(card,'.playercard-27-position'),price:price(text(node,'.platform-ps-only .price-segment')),url:node.querySelector('a')?.href};
    }).filter(Boolean);
    const required=Number((document.body.innerText||document.body.textContent||'').match(/#\s*of players in squad:\s*(\d+)/i)?.[1])||embeddedResult?.expectedSlots;
    if(players.length!==(required||cards.length) || !players.length) return {error:`Waiting for the complete squad (${players.length}/${required||cards.length} players loaded).`,incompleteSquad:true,expectedSlots:required||cards.length};
    if(players.some(p=>!p.baseId || !p.rating || !Number.isInteger(p.rarity))) return {error:'FUTBIN card identities could not be read from this squad layout.'};
    if(players.some(p=>!p.price)) return {error:'Waiting for console player prices; one or more are missing.'};
    if(!challengeId) return {error:'The squad page has no matching SBC challenge link.'};
    return {kind:'squad',year:27,market:'console',name:link?.textContent.trim()||'SBC squad',challengeId,requiredPlayers:required||players.length,players,total:players.reduce((s,p)=>s+(p.price||0),0),url:location.href,checkedAt:Date.now()};
  }
  const pageText=(document.body?.innerText||document.body?.textContent||'').slice(0,1500);
  if(/Just a moment|security verification|verify (?:that )?you are human|checking your browser/i.test(document.title+' '+pageText)) return {error:'FUTBIN is checking this browser.',blocked:true,verification:true};
  if(embeddedResult?.error)return embeddedResult;
  const title=String(document.title||'Untitled page').slice(0,120);
  const heading=text(document,'h1').slice(0,120);
  return {error:`FUTBIN has not loaded a supported completed-challenge table or squad yet. Title: ${title}. Heading: ${heading||'none'}. State: ${document.readyState}, ${document.visibilityState}. Cards: ${cards.length}; FC 27 cards: ${document.querySelectorAll('.playercard-27').length}.`};
}
