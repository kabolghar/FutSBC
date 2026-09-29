// Discover URLs published by FUTBIN rather than constructing an alternative ID.
export function readSbcDirectory(expectedURL){
  if(expectedURL&&location.href!==expectedURL)return {error:'Waiting for the requested discovery document.'};
  const origin='https://www.futbin.com';
  if(location.origin!==origin||!/^\/27\/squad-building-challenges\/?$/.test(location.pathname)&&!/^\/27\/squad-building-challenge\/\d+\/?$/.test(location.pathname))return {error:'Unexpected SBC discovery page.'};
  const text=document.body?.innerText||document.body?.textContent||'';
  if(/Just a moment|security verification|verify (?:that )?you are human|checking your browser/i.test(document.title+' '+text.slice(0,1500)))return {verification:true,error:'FUTBIN is checking this browser.'};
  if(text.length<1000&&/the page could not be found/i.test(text))return {unavailable:true,error:'FUTBIN could not find this SBC page.'};
  const completed=[],groups=[],pages=[];
  for(const anchor of document.querySelectorAll('a[href]')){
    let url;try{url=new URL(anchor.getAttribute('href'),location.href);}catch{continue;}
    if(url.origin!==origin)continue;
    const match=url.pathname.match(/^\/27\/squad-building-challenges\/[^/]+\/(\d+)\/[^/]+\/?$/);
    if(match)completed.push({id:Number(match[1]),url:url.href});
    if(/^\/27\/squad-building-challenge\/\d+\/?$/.test(url.pathname))groups.push({url:url.href,title:anchor.textContent.trim()});
    if(url.pathname==='/27/squad-building-challenges'&&/^\d+$/.test(url.searchParams.get('page')||''))pages.push(url.href);
  }
  if(!completed.length&&!groups.length&&!document.querySelector('h1'))return {error:'Waiting for the SBC directory.'};
  return {kind:'discovery',completed,groups,pages};
}
export async function discoverSbc(api,tabId,challenge,{attempts=30,delay=()=>new Promise(resolve=>setTimeout(resolve,400)),progress=async()=>{}}={}){
  const directory='https://www.futbin.com/27/squad-building-challenges';
  const visit=async url=>{
    await api.tabs.update(tabId,{url});
    let reason='FUTBIN did not load its SBC directory.',verification=false;
    for(let i=0;i<attempts;i++){
      const tab=await api.tabs.get(tabId);
      if(tab.url===url){
        let result;
        try{result=(await api.scripting.executeScript({target:{tabId},func:readSbcDirectory,args:[url]}))[0]?.result;}catch(error){reason=error.message;}
        verification=!!result?.verification;
        if(result?.kind==='discovery')return result;
        if(result?.unavailable)return {completed:[],groups:[],pages:[]};
        if(result?.error)reason=result.error;
      }
      if(i<attempts-1)await delay();
    }
    const error=Error(verification?'FUTBIN browser verification prevented SBC discovery. No squad changes were made.':reason);
    if(verification)error.verificationBlocked=true;
    throw error;
  };
  const queue=[directory],seen=new Set(),groups=new Map();
  const match=result=>result.completed.find(row=>row.id===challenge.id)?.url;
  while(queue.length&&seen.size<5){
    const url=queue.shift();if(seen.has(url))continue;seen.add(url);
    await progress('Finding the SBC in FUTBIN’s directory…');
    const result=await visit(url),found=match(result);if(found)return found;
    for(const group of result.groups)groups.set(group.url,group);
    for(const page of result.pages)if(!seen.has(page)&&!queue.includes(page))queue.push(page);
  }
  const name=String(challenge.name).toLowerCase();
  const ordered=[...groups.values()].sort((a,b)=>Number(b.title.toLowerCase().includes(name))-Number(a.title.toLowerCase().includes(name))).slice(0,40);
  let unread=0;
  for(const [index,group] of ordered.entries()){
    await progress(`Finding the exact SBC · group ${index+1}/${ordered.length}`);
    try{const found=match(await visit(group.url));if(found)return found;}
    catch(error){if(error.verificationBlocked)throw error;unread++;}
  }
  const error=Error(`FUTBIN’s lookup is unavailable and its directory did not expose an exact match for ${challenge.name} (EA ${challenge.id}). ${unread?`${unread} group pages could not be read. `:''}No squad changes were made. A direct Completed Challenges link can still be used.`);
  error.sbcUnavailable=true;throw error;
}
