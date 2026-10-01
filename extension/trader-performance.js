// Confirmed sale outcomes, never listing forecasts, drive execution feedback.
export function reconcileSales(ledger, updates, now=Date.now()){
 const byItem=new Map(updates.map(update=>[String(update.itemId),update]));
 return ledger.map(record=>{
  if(record.soldAt)return record;
  const update=byItem.get(String(record.itemId));
  if(!update||update.definitionId!==record.definitionId)return record;
  if(update.phase==='sold'&&Number.isSafeInteger(update.sale)&&update.sale>=150){
   return {...record,state:'sold',sale:update.sale,soldAt:now,profit:Math.floor(update.sale*.95)-record.buy,timeToSellMs:Math.max(0,now-record.listedAt)};
  }
  return {...record,state:update.phase,checkedAt:now};
 });
}
export function tradingPerformance(ledger,now=Date.now()){
 const stats=new Map();
 for(const record of ledger){
  if(now-(record.soldAt||record.listedAt)>7*86400000)continue;
  const row=stats.get(record.definitionId)||{sales:0,profit:0,losses:0,totalSellMs:0,unsold:0};
  if(record.soldAt){row.sales++;row.profit+=record.profit;row.losses+=Number(record.profit<0);row.totalSellMs+=record.timeToSellMs;}
  else if(record.state==='expired'||now-record.listedAt>2*3600000)row.unsold++;
  stats.set(record.definitionId,row);
 }
 return stats;
}
export function quickFlipCards(cards,ledger=[],now=Date.now()){
 const stats=tradingPerformance(ledger,now);
 return cards.filter(card=>card.updatedSeconds<=120&&Math.abs(card.trend)<=5&&card.consolePrice/card.eaAverage>=.85&&card.consolePrice/card.eaAverage<=1.15).map(card=>{
  const result=stats.get(card.assetId);
  const feedback=result?result.profit/Math.max(1,result.sales)-result.unsold*100-result.losses*200-result.totalSellMs/Math.max(1,result.sales)/60000*2:0;
  return {...card,marginStrategy:'quick-flip',risk:'unrated',executionScore:feedback,performance:result||null};
 }).filter(card=>!card.performance||card.performance.sales<3||card.performance.profit>0).sort((a,b)=>b.executionScore-a.executionScore||a.consolePrice-b.consolePrice||a.updatedSeconds-b.updatedSeconds).slice(0,8);
}
