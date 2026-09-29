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
export function assessTradeEvidence({card,samplePrices,dayChange,trendMedian,signal,headlines,related,quoteFresh=false,buyCeiling=0}) {
  const votes=Number(signal?.positive)+Number(signal?.negative);
  const community=Number.isSafeInteger(signal?.positive)&&signal.positive>=0&&Number.isSafeInteger(signal?.negative)&&signal.negative>=0&&votes>=30&&signal.positive/votes>=.70&&Number.isSafeInteger(signal?.games)&&signal.games>=10000;
  const prices=samplePrices.filter(price=>Number.isSafeInteger(price)&&price>0);
  const allPrices=[...prices,card.price];
  const range=prices.length?(Math.max(...allPrices)-Math.min(...allPrices))/Math.min(...allPrices)*100:null;
  const gaps=[],hazards=[];
  if(prices.length<3)gaps.push('Need three recent daily price samples');
  if(!community)gaps.push('Player demand is not supported by community votes and usage');
  if(!headlines.length)gaps.push('Current editorial coverage is unavailable');
  if(range!==null&&range>20)hazards.push('Recent prices are volatile');
  if(dayChange!==null&&(dayChange< -8||dayChange>10))hazards.push('Price is moving too sharply');
  if(card.trend< -5||card.trend>8)hazards.push('Current trend is unstable');
  if(trendMedian< -4)hazards.push('The sampled market is falling');
  if(related?.kind==='rumour')hazards.push('Player-linked news is unconfirmed');
  if(related&&['SBC','Marquee Matchups'].includes(related.topic))hazards.push('A named-player SBC does not prove demand for this card version');
  const eligible=!gaps.length&&!hazards.length;
  // A conditional short flip, stress-tested below the lowest sampled price.
  // Community usage is a demand proxy, never proof of completed sales.
  const stressedNet=Math.floor(Math.min(...allPrices)*.95*.95)-buyCeiling;
  const low=eligible&&prices.length>=5&&quoteFresh&&range<=8&&Number.isFinite(dayChange)&&Math.abs(dayChange)<=3&&Math.abs(card.trend)<=3&&trendMedian>=-2&&votes>=100&&signal.positive/votes>=.8&&signal.games>=50000&&buyCeiling>0&&stressedNet>=Math.max(100,buyCeiling*.1);
  const risk=hazards.length?'high':!eligible?'unrated':low?'low':'medium';
  const confidence=gaps.length?'limited':prices.length>=5&&quoteFresh?'strong':'moderate';
  const riskReason=hazards.length?hazards.join(' · '):!eligible?'Not enough evidence to rate this trade.':low?'Five or more stable daily samples, strong community use and a margin after fees even at a 5% lower resale price. Only at or below the buy ceiling, with a 1–3 day review window.':'Evidence supports a conditional short flip, but the stricter low-risk checks were not all met.';
  const reasons=[...hazards,...gaps];
  return {eligible,risk,confidence,riskReason,dataGaps:gaps,hazards,strategy:eligible?'Community-supported short flip':'Watchlist',reasons,reason:riskReason+' '+(gaps.length?gaps.join(' · ')+'. ':'')+'Listings do not prove sales liquidity.',range,community,stressedNet,sourceURLs:headlines.map(item=>item.url),exitRule:'Recheck within 24h. Reassess if price falls 5%, pack supply increases, or replacement content releases. Do not average down automatically.'};
}
export function researchTraderCards(eligible,brief){
  const byId=new Map(eligible.map(card=>[card.assetId,card]));
  return brief.candidates.filter(idea=>idea.stance==='consider'&&idea.evidence?.eligible&&['low','medium'].includes(idea.risk)).map(idea=>({...byId.get(idea.assetId),research:idea.evidence,researchBidCeiling:idea.buyCeiling})).filter(card=>card.assetId).slice(0,4);
}
