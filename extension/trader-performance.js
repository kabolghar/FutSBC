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
  const observedMinutes=result?.sales?Math.max(1,result.totalSellMs/result.sales/60000):null;
  const feedback=result?.sales>=3?result.profit/result.sales/card.consolePrice/observedMinutes*(1-result.losses/result.sales)-result.unsold*.01:0;
  return {...card,marginStrategy:'quick-flip',risk:'unrated',executionScore:feedback,expectedSellMinutes:result?.sales>=3?observedMinutes:null,performance:result||null};
 }).filter(card=>!card.performance||card.performance.sales<3||card.performance.profit>0).sort((a,b)=>b.executionScore-a.executionScore||a.consolePrice-b.consolePrice||a.updatedSeconds-b.updatedSeconds).slice(0,8);
}

export function portfolioSummary(ledger,now=Date.now()){
 const sold=ledger.filter(row=>Number.isSafeInteger(row.profit)&&row.soldAt);
 const today=sold.filter(row=>now-row.soldAt<=86400000);
 const pending=ledger.filter(row=>!row.soldAt);
 const ordered=[...sold].sort((a,b)=>a.soldAt-b.soldAt);
 let equity=0,peak=0,drawdown=0;
 for(const row of ordered){equity+=row.profit;peak=Math.max(peak,equity);drawdown=Math.max(drawdown,peak-equity);}
 return {realized: sold.reduce((sum,row)=>sum+row.profit,0),dayProfit:today.reduce((sum,row)=>sum+row.profit,0),sales:sold.length,losses:sold.filter(row=>row.profit<0).length,maxDrawdown:drawdown,pending:pending.length,inventoryCost:pending.reduce((sum,row)=>sum+row.buy,0),expired:pending.filter(row=>row.state==='expired').length,unverified:pending.filter(row=>row.state==='unverified').length,averageSellMinutes:sold.length?Math.round(sold.reduce((sum,row)=>sum+row.timeToSellMs,0)/sold.length/60000):null,activity:[...ledger].sort((a,b)=>(b.soldAt||b.listedAt)-(a.soldAt||a.listedAt)).slice(0,12)};
}

// Priority only: historic returns and observed turnover are not guaranteed future sales.
export function selectHuntCard(cards,activeBids=[],ledger=[],index=0,now=Date.now()){
 if(!cards.length)return null;
 const exposure=new Map();
 for(const row of [...activeBids,...ledger.filter(row=>!row.soldAt)])exposure.set(row.definitionId,(exposure.get(row.definitionId)||0)+1);
 const rotated=cards.map((_,offset)=>cards[(index+offset)%cards.length]);
 return rotated.map((card,order)=>({card,order,exposure:exposure.get(card.assetId)||0})).sort((a,b)=>a.exposure-b.exposure||a.order-b.order)[0].card;
}
