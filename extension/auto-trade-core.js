import {tradeMath} from './trade-core.js';

export function evaluateListing(buy,comparables,balance,futbinPrice=null){
  if(!Number.isSafeInteger(balance)||balance<0) throw Error('Coin balance is unavailable.');
  if(!Number.isSafeInteger(buy)||buy<150||buy>balance) return null;
  const prices=comparables.filter(price=>Number.isSafeInteger(price)&&price>0).sort((a,b)=>a-b);
  if(prices.length<5) return null;
  const reference=prices[0];
  const step=price=>price<1000?50:price<10000?100:price<50000?250:price<100000?500:1000;
  const floor=price=>Math.floor(price/step(price))*step(price);
  if(futbinPrice!==null&&(!Number.isSafeInteger(futbinPrice)||futbinPrice<200))return null;
  const sell=Math.min(Math.max(150,floor(reference-1)),futbinPrice===null?Infinity:floor(futbinPrice));
  if(sell<=buy) return null;
  const minimumProfit=Math.max(200,Math.ceil(buy*0.08/50)*50);
  const math=tradeMath(buy,sell,minimumProfit);
  return math.meetsTarget?{buy,sell,reference,profit:math.profit,minimumProfit}:null;
}

export function rankOpportunities(listings,balance){
  return listings.map(row=>({row,offer:evaluateListing(row.buy,row.comparables,balance,row.futbinPrice??null)}))
    .filter(entry=>entry.offer)
    .sort((a,b)=>b.offer.profit-a.offer.profit||a.offer.buy-b.offer.buy);
}
