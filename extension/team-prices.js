const MAX_AGE=6*60*60_000;
const CACHE_AGE=10*60_000;
export function validEstimate(quote,id,now=Date.now()){
  return quote?.definitionId===id&&quote.source==='fodder.gg'&&Number.isSafeInteger(quote.price)&&quote.price>=150&&quote.price<=15_000_000&&Number.isSafeInteger(quote.updatedAt)&&quote.updatedAt<=now+60_000&&now-quote.updatedAt<=MAX_AGE;
}
export function parseConsolePrices(data,ids,now=Date.now()){
  if(!data||typeof data.prices!=='object'||typeof data.updated!=='object')return [];
  return ids.flatMap(id=>{
    if(data.extinct?.includes(id))return [];
    const quote={definitionId:id,price:data.prices[id],updatedAt:Number(data.updated[id])*1000,fetchedAt:now,source:'fodder.gg'};
    const range=data.ranges?.[id];
    if(Array.isArray(range)&&(quote.price<range[0]||quote.price>range[1]))return [];
    return validEstimate(quote,id,now)?[quote]:[];
  });
}
export async function getConsoleEstimates(ids,cache={},fetcher=fetch,now=Date.now()){
  const wanted=[...new Set(ids)].filter(id=>Number.isSafeInteger(id)&&id>0).slice(0,330);
  const quotes=new Map(),next={};
  for(const [key,quote] of Object.entries(cache))if(validEstimate(quote,Number(key),now))next[key]=quote;
  for(const id of wanted)if(next[id])quotes.set(id,next[id]);
  const missing=wanted.filter(id=>!next[id]||!Number.isSafeInteger(next[id].fetchedAt)||now-next[id].fetchedAt>CACHE_AGE);
  // This endpoint serves the site's current season rather than a year in its URL.
  if(missing.length){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),7000);
    try{
      const page=await fetcher('https://fodder.gg/players',{signal:controller.signal,credentials:'omit'});
      if(!page.ok)throw Error('Provider unavailable');
      if(!/<title>[^<]*EA FC 27\b/i.test(await page.text()))return {quotes:[],cache:{},unavailable:true};
    }catch{return {quotes:[...quotes.values()],cache:next,unavailable:true};}
    finally{clearTimeout(timer);}
  }
  const batches=[];for(let start=0;start<missing.length;start+=10)batches.push(missing.slice(start,start+10));
  let cursor=0,unavailable=false;
  await Promise.all(Array.from({length:Math.min(3,batches.length)},async()=>{
    while(cursor<batches.length&&!unavailable){
      const batch=batches[cursor++],controller=new AbortController(),timer=setTimeout(()=>controller.abort(),7000);
      try{
        const response=await fetcher(`https://fodder.gg/api/prices?ids=${batch.join(',')}&platform=console`,{signal:controller.signal,credentials:'omit'});
        if(!response.ok)throw Error('Price provider unavailable');
        const data=await response.json();
        if(!data?.prices||!data?.updated||typeof data.prices!=='object'||typeof data.updated!=='object'||Array.isArray(data.prices)||Array.isArray(data.updated))throw Error('Invalid price response');
        for(const id of batch){quotes.delete(id);delete next[id];}
        for(const quote of parseConsolePrices(data,batch,now)){quotes.set(quote.definitionId,quote);next[quote.definitionId]=quote;}
      }catch{unavailable=true;}finally{clearTimeout(timer);}
    }
  }));
  return {quotes:[...quotes.values()],cache:next,unavailable};
}
