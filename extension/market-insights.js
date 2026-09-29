const DAY=86_400_000;
const floorMarketPrice=value=>{const step=value<1000?50:value<10000?100:value<50000?250:value<100000?500:1000;return Math.floor(value/step)*step;};
const validCard=card=>Number.isSafeInteger(card?.assetId)&&card.assetId>0&&card.revision==='Normal'&&Number.isSafeInteger(card.consolePrice)&&card.consolePrice>=500&&Number.isSafeInteger(card.eaAverage)&&card.eaAverage>=150&&Number.isSafeInteger(card.updatedSeconds)&&card.updatedSeconds>=0&&card.updatedSeconds<=600&&Number.isFinite(card.trend)&&Math.abs(card.trend)<=20&&/^https:\/\/www\.futbin\.com\/27\/player\/\d+\//.test(card.url||'');
const median=values=>{const sorted=[...values].sort((a,b)=>a-b);return sorted.length?sorted[Math.floor(sorted.length/2)]:null;};
const dayAt=now=>new Date(now).toISOString().slice(0,10);
const riskFor=(days,trend,dayChange)=>days>=5&&Math.abs(trend)<=3&&dayChange!==null&&Math.abs(dayChange)<=8?'low':days>=2&&Math.abs(trend)<=8?'medium':'high';
const normalized=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
function relatedHeadline(card,headlines){
  const full=normalized(card.name).trim(),last=full.split(/\s+/).at(-1);
  return headlines.find(headline=>full.length>=5&&normalized(headline.title).includes(full)||last?.length>=6&&normalized(headline.title).includes(last));
}
function holdPlan(card,historyDays,stance,signal,headline){
  const votes=Number(signal?.positive)+Number(signal?.negative);
  const approval=Number.isSafeInteger(signal?.positive)&&Number.isSafeInteger(signal?.negative)&&votes>=10?Math.round(100*signal.positive/votes):null;
  const games=Number.isSafeInteger(signal?.games)?signal.games:null;
  const strongOpinion=approval!==null&&approval>=60&&games!==null&&games>=10000;
  const supportedMeta=historyDays>=7&&strongOpinion&&card.trend>=0&&card.trend<=5;
  const goodMomentum=historyDays>=3&&strongOpinion&&card.trend>=0&&card.trend<=8;
  if(headline?.kind==='rumour')return {label:'Wait for confirmation',minDays:0,maxDays:1,basis:'Player-linked rumour only; review tomorrow, not a buy catalyst.',sourceURL:headline.url,approval,votes:approval===null?null:votes,games};
  if(headline&&['SBC','Marquee Matchups'].includes(headline.topic)&&historyDays>=2)return {label:'1–3 days',minDays:1,maxDays:3,basis:'Player-linked reported content; reassess demand as the content goes live.',sourceURL:headline.url,approval,votes:approval===null?null:votes,games};
  if(supportedMeta)return {label:'1–3 weeks',minDays:7,maxDays:21,basis:'Seven prior price samples, rising price and strong community use; review daily for meta or supply changes.',sourceURL:null,approval,votes:approval===null?null:votes,games};
  if(goodMomentum)return {label:'3–7 days',minDays:3,maxDays:7,basis:'Repeated price samples and positive community use support a shorter momentum hold.',sourceURL:null,approval,votes:approval===null?null:votes,games};
  if(historyDays>=2&&stance==='consider')return {label:'1–3 days',minDays:1,maxDays:3,basis:'Current price is below sampled prior prices; review for a rebound within three days.',sourceURL:null,approval,votes:approval===null?null:votes,games};
  if(historyDays>=2)return {label:'1–2 days',minDays:1,maxDays:2,basis:'Price history exists, but demand evidence is limited; reassess quickly.',sourceURL:null,approval,votes:approval===null?null:votes,games};
  return {label:'Review in 24h',minDays:0,maxDays:1,basis:'Not enough daily price samples to estimate a hold.',sourceURL:null,approval,votes:approval===null?null:votes,games};
}

export function recordMarketSnapshot(history,pages,now=Date.now()){
  const cards=new Map();
  for(const page of pages||[]){
    if(page?.kind!=='market'||Math.abs(now-page.checkedAt)>10*60_000)continue;
    for(const card of page.cards||[]){
      if(!validCard(card)||cards.has(card.assetId))continue;
      cards.set(card.assetId,{assetId:card.assetId,name:card.name,url:card.url,price:card.consolePrice,eaAverage:card.eaAverage,trend:card.trend,updatedSeconds:card.updatedSeconds,revision:card.revision,sourceURL:page.url});
    }
  }
  if(!cards.size)throw Error('No fresh FC 27 console prices passed the data checks.');
  const snapshot={day:dayAt(now),at:now,cards:[...cards.values()].slice(0,350)};
  const older=(history||[]).filter(entry=>entry?.day!==snapshot.day&&entry?.day>=dayAt(now-31*DAY)&&Array.isArray(entry.cards));
  return {snapshot,history:[...older,snapshot].sort((a,b)=>a.day.localeCompare(b.day)).slice(-31)};
}

export function buildMarketBrief(snapshot,history,balance,headlines=[],now=Date.now(),signals={}){
  if(!snapshot?.cards?.length||!Number.isSafeInteger(snapshot.at)||now-snapshot.at>36*60*60_000)throw Error('Refresh current FUTBIN prices before building an investment brief.');
  const previous=(history||[]).filter(entry=>entry.day<snapshot.day).sort((a,b)=>b.day.localeCompare(a.day));
  const trendMedian=median(snapshot.cards.map(card=>card.trend));
  const cleanHeadlines=(headlines||[]).filter(item=>/^https:\/\/www\.futbin\.com\/news\/articles\/\d+\//.test(item?.url||'')&&typeof item.title==='string'&&Number.isFinite(item.at)&&item.at<=now&&now-item.at<=10*DAY).slice(0,8).map(item=>({title:item.title.slice(0,160),url:item.url,at:item.at,kind:/\b(leak(?:ed|s)?|rumou?r(?:ed|s)?|prediction|predicted)\b/i.test(item.title)?'rumour':'reported',topic:/marquee matchups?/i.test(item.title)?'Marquee Matchups':/\bSBCs?\b|squad building challenge/i.test(item.title)?'SBC':/\b(meta|patch|gameplay|playstyle|tactics|title update)\b/i.test(item.title)?'Meta':'Market'}));
  const candidates=[];
  for(const card of snapshot.cards){
    if(!Number.isSafeInteger(balance)||card.price>balance||card.price<500)continue;
    const prior=previous.find(entry=>entry.cards.some(row=>row.assetId===card.assetId));
    const oldPrice=prior?.cards.find(row=>row.assetId===card.assetId)?.price;
    const dayChange=oldPrice?Math.round((card.price/oldPrice-1)*1000)/10:null;
    const samplePrices=previous.slice(0,7).map(entry=>entry.cards.find(row=>row.assetId===card.assetId)?.price).filter(Number.isSafeInteger);
    const baseline=median(samplePrices);
    const discount=Math.round((1-card.price/card.eaAverage)*1000)/10;
    if(card.price/card.eaAverage<.7||card.price/card.eaAverage>1.15||card.trend>12||card.trend< -15)continue;
    const dipped=baseline&&card.price<=baseline*.92&&card.trend>=-8;
    const stance=dipped&&samplePrices.length>=2?'consider':'watch';
    const ceiling=floorMarketPrice(Math.min(card.price*.84,(baseline||card.price)*.80));
    if(ceiling<150)continue;
    const score=(dipped?30:0)+Math.max(-10,Math.min(15,discount))*2+(dayChange!==null&&dayChange<0?Math.min(12,-dayChange):0)-Math.abs(card.trend)*.5+(samplePrices.length>=2?10:0);
    const sellTarget=card.price;
    const projectedNet=Math.floor(sellTarget*.95)-ceiling;
    const hold=holdPlan(card,samplePrices.length,stance,signals[card.assetId],relatedHeadline(card,cleanHeadlines));
    const risk=hold.label==='Wait for confirmation'||hold.maxDays>=21?'high':riskFor(samplePrices.length,card.trend,dayChange);
    const opinionBoost=hold.approval===null?0:Math.max(-8,Math.min(8,(hold.approval-50)/4));
    candidates.push({assetId:card.assetId,name:card.name,url:card.url,price:card.price,eaAverage:card.eaAverage,trend:card.trend,dayChange,baseline,historyDays:samplePrices.length,stance,buyCeiling:ceiling,sellTarget,projectedNet,risk,hold,filter:`Normal player · max ${ceiling.toLocaleString()} coins`,score:Math.round(score+opinionBoost),sourceURL:card.sourceURL});
  }
  candidates.sort((a,b)=>b.score-a.score||a.price-b.price);
  return {at:now,day:snapshot.day,market:'FC 27 console',sampleSize:snapshot.cards.length,trendMedian,balance,historyDays:previous.length,candidates:candidates.slice(0,12),headlines:cleanHeadlines,model:null};
}

export function validateModelBrief(output,brief){
  const allowed=new Map(brief.candidates.map(card=>[card.assetId,card]));
  const notes=[];
  for(const item of output?.ideas||[]){
    const card=allowed.get(Number(item.assetId));
    if(!card||notes.some(note=>note.assetId===card.assetId))continue;
    const stance=['watch','consider','avoid'].includes(item.stance)?item.stance:'watch';
    if(stance==='consider'&&card.stance!=='consider')continue;
    if(item.catalystURL&&!brief.headlines.some(headline=>headline.url===item.catalystURL))continue;
    const reason=String(item.reason||'').trim().slice(0,250);
    if(!reason||/\bguaranteed\b/i.test(reason))continue;
    const proof=brief.headlines.find(headline=>headline.url===item.catalystURL);
    notes.push({assetId:card.assetId,stance,reason,catalystURL:proof?.url||null,catalystKind:proof?.kind||null});
    if(notes.length>=6)break;
  }
  return notes;
}
