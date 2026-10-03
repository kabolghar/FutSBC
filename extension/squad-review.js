// Market observations are exact-version and position scoped, never account data.
const DAY=86400000;
export function reviewSquad(team,quotes,rankings,history={},now=Date.now()){
  const next={},rows=[];
  for(const [key,samples] of Object.entries(history))if(Array.isArray(samples)){const recent=samples.filter(s=>Number.isSafeInteger(s.at)&&s.at<=now&&now-s.at<=30*DAY).slice(-60);if(recent.length)next[key]=recent;}
  for(const player of team.players||[]){
    if(!player.definitionId||player.concept)continue;
    const key=`${player.definitionId}:${player.position}`;
    const quote=quotes.find(q=>q.definitionId===player.definitionId&&Number.isSafeInteger(q.price)&&q.price>=150&&Number.isSafeInteger(q.updatedAt)&&q.updatedAt<=now+60000&&now-q.updatedAt<=6*3600000);
    const ranking=rankings.find(r=>r.position===player.position&&r.definitionId===player.definitionId&&r.source==='FUT.GG'&&Number.isInteger(r.rank)&&r.rank>=1&&r.rank<=120&&Number.isSafeInteger(r.checkedAt)&&r.checkedAt<=now+60000&&now-r.checkedAt<=10*60000);
    const samples=next[key]||[];
    const pricePrior=[...samples].reverse().find(s=>now-s.at>=DAY&&now-s.at<=14*DAY&&Number.isSafeInteger(s.price)&&s.priceSource===quote?.source);
    const rankPrior=[...samples].reverse().find(s=>now-s.at>=DAY&&now-s.at<=14*DAY&&Number.isInteger(s.rank)&&s.rankingURL===ranking?.url);
    const priceChange=quote&&pricePrior?(quote.price-pricePrior.price)/pricePrior.price*100:null;
    const rankChange=ranking&&rankPrior?ranking.rank-rankPrior.rank:null;
    const signals=[];
    if(priceChange<=-10&&priceChange!==null)signals.push({kind:'price',label:`Price down ${Math.abs(priceChange).toFixed(1)}%`,since:pricePrior.at});
    if(rankChange>=8&&ranking.rank>=rankPrior.rank*1.25)signals.push({kind:'ranking',label:`Budget rank #${rankPrior.rank} → #${ranking.rank}`,since:rankPrior.at});
    rows.push({...player,price:quote?.price??null,priceSource:quote?.source??null,priceUpdatedAt:quote?.updatedAt??null,netSaleEstimate:player.tradable===true&&quote?Math.floor(quote.price*.95):null,rank:ranking?.rank??null,rankingURL:ranking?.url??null,rankCheckedAt:ranking?.checkedAt??null,priceChange,rankChange,signals});
    // Multiple refreshes in one day replace only today's observation, preserving
    // older independent samples. A missing provider never erases known evidence.
    if(quote||ranking){
      const today=samples.find(s=>Math.floor(s.at/DAY)===Math.floor(now/DAY))||{};
      next[key]=[...samples.filter(s=>Math.floor(s.at/DAY)!==Math.floor(now/DAY)),{...today,at:now,...(quote?{price:quote.price,priceSource:quote.source}:{}),...(ranking?{rank:ranking.rank,rankingURL:ranking.url}:{})}].slice(-60);
    }
  }
  return {fingerprint:team.fingerprint,checkedAt:now,rows,history:next,suggestedSlots:rows.filter(r=>r.signals.length).sort((a,b)=>b.signals.length-a.signals.length||(a.priceChange??0)-(b.priceChange??0)).slice(0,3).map(r=>r.index)};
}

// A bounded rescue search may replace supporting cards, but never explicit
// build-around picks or concepts. Prefer useful links over arbitrary weak cards.
export function supportCandidates(team,requested,picks,results){
  const protectedSlots=new Set([...requested,...picks.map(p=>p.slotIndex)]);
  const targets=results.filter(g=>requested.includes(g.slotIndex)).flatMap(g=>g.options.filter(o=>o.priceVerified).slice(0,8));
  const links=(a,b)=>['leagueId','nationId','clubId'].filter(k=>a[k]>0&&a[k]===b[k]).length;
  return (team.players||[]).filter(p=>p.definitionId&&!p.concept&&!protectedSlots.has(p.index)).map(p=>({index:p.index,score:targets.reduce((sum,t)=>sum+links(p,t),0)*10+(3-(p.chemistry||0))*2+(100-(p.rating||75))/20})).sort((a,b)=>b.score-a.score||a.index-b.index).slice(0,3).map(p=>p.index);
}
export function requestedCovered(plan,slots){return !!plan&&slots.every(index=>plan.choices.some(c=>c.slotIndex===index&&!c.retained));}
