// Runs in a FUTBIN player tab; only accepts the exact FC 27 card page requested.
export function readFutbinPlayerSignal(expectedURL){
  const expected=new URL(expectedURL),actual=new URL(location.href);
  if(actual.origin!=='https://www.futbin.com'||actual.pathname!==expected.pathname)return {error:'Waiting for the requested player page.'};
  const body=document.body?.innerText||'';
  if(/Just a moment|security verification|verify (?:that )?you are human|checking your browser/i.test(document.title+' '+body.slice(0,500)))return {error:'FUTBIN blocked this player page.',blocked:true};
  if(!/\bVotes\b/.test(body))return {error:'Player votes are not visible yet.'};
  const votes=body.match(/(?:^|\n)\s*([\d,]+)\s*\n\s*([\d,]+)\s*\n\s*Votes\b/);
  const positive=Number(votes?.[1]?.replaceAll(',','')),negative=Number(votes?.[2]?.replaceAll(',',''));
  const games=body.match(/used in ([\d,]+) games/i);
  const played=Number(games?.[1]?.replaceAll(',',''));
  return {kind:'player-signal',url:actual.href,checkedAt:Date.now(),positive:Number.isSafeInteger(positive)?positive:null,negative:Number.isSafeInteger(negative)?negative:null,games:Number.isSafeInteger(played)?played:null};
}
