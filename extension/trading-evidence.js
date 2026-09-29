// Editorial context is not a verified SBC requirement or a completed market sale.
export function cleanTradingHeadlines(items, now=Date.now()) {
  const seen=new Set();
  return (items||[]).filter(item=>{
    let url;try{url=new URL(item.url);}catch{return false;}
    const approved=url.origin==='https://www.futbin.com'&&/^\/news\/articles\/\d+\//.test(url.pathname)||url.origin==='https://www.fut.gg'&&/^\/news\/[^/]+\/$/.test(url.pathname);
    if(!approved||seen.has(url.href)||typeof item.title!=='string'||!Number.isFinite(item.at)||item.at>now||now-item.at>7*86400000||/\b(?:FC|FIFA)\s*(?:2[0-6]|1\d)\b/i.test(item.title))return false;
    seen.add(url.href);return true;
  }).map(item=>({...item,title:item.title.slice(0,160),source:new URL(item.url).hostname==='www.fut.gg'?'FUT.GG':'FUTBIN',kind:/\b(leak(?:ed|s)?|rumou?r(?:ed|s)?|prediction|predicted)\b/i.test(item.title)?'rumour':'reported',topic:/marquee matchups?/i.test(item.title)?'Marquee Matchups':/\bSBCs?\b|squad building challenge/i.test(item.title)?'SBC':/\b(meta|patch|gameplay|playstyle|tactics|title update)\b/i.test(item.title)?'Meta':'Market'})).sort((a,b)=>b.at-a.at).slice(0,24);
}
export function assessTradeEvidence({card,samplePrices,dayChange,trendMedian,signal,headlines,related}) {
  const votes=Number(signal?.positive)+Number(signal?.negative);
  const community=Number.isSafeInteger(signal?.positive)&&signal.positive>=0&&Number.isSafeInteger(signal?.negative)&&signal.negative>=0&&votes>=30&&signal.positive/votes>=.70&&Number.isSafeInteger(signal?.games)&&signal.games>=10000;
  const range=samplePrices.length?(Math.max(...samplePrices)-Math.min(...samplePrices))/Math.min(...samplePrices)*100:null;
  const reasons=[];
  if(samplePrices.length<3)reasons.push('Need three recent daily price samples');
  if(!community)reasons.push('Player demand is not supported by community votes and usage');
  if(!headlines.length)reasons.push('Current editorial coverage is unavailable');
  if(range!==null&&range>20)reasons.push('Recent prices are volatile');
  if(dayChange!==null&&(dayChange< -8||dayChange>10))reasons.push('Price is moving too sharply');
  if(card.trend< -5||card.trend>8)reasons.push('Current trend is unstable');
  if(trendMedian< -4)reasons.push('The sampled market is falling');
  if(related?.kind==='rumour')reasons.push('Player-linked news is unconfirmed');
  if(related&&['SBC','Marquee Matchups'].includes(related.topic))reasons.push('A named-player SBC does not prove demand for this card version');
  const eligible=reasons.length===0;
  return {eligible,risk:eligible?'medium':'high',strategy:eligible?'Community-supported short flip':'Watchlist',reasons,reason:eligible?'Recent stable prices and community usage support a conditional short flip. Listings do not prove sales liquidity.':reasons.join(' · '),range,community,sourceURLs:headlines.map(item=>item.url),exitRule:'Recheck within 24h. Reassess if price falls 5%, pack supply increases, or replacement content releases. Do not average down automatically.'};
}
export function researchTraderCards(eligible,brief){
  const byId=new Map(eligible.map(card=>[card.assetId,card]));
  return brief.candidates.filter(idea=>idea.stance==='consider'&&idea.evidence?.eligible&&idea.risk!=='high').map(idea=>({...byId.get(idea.assetId),research:idea.evidence,researchBidCeiling:idea.buyCeiling})).filter(card=>card.assetId).slice(0,4);
}
