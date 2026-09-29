// Self-contained: chrome.scripting runs this in an existing FUTBIN tab.
// Same-origin page requests avoid navigating to every listed squad.
export async function readFutbinSquadBatch(urls,expectedChallengeId){
  if(location.origin!=='https://www.futbin.com')return {error:'FUTBIN background tab is on the wrong website.'};
  const readOne=async requestedURL=>{
    const url=new URL(requestedURL);
    if(url.origin!==location.origin||!/^\/27\/squad\/\d+\/sbc\/?$/.test(url.pathname))return {url:requestedURL,error:'Invalid FC 27 FUTBIN squad address.'};
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),15000);
    try{
      const response=await fetch(url.href,{credentials:'same-origin',cache:'no-store',signal:controller.signal});
      if(!response.ok)return {url:url.href,fallback:true,verification:response.status===403||response.status===429,error:`FUTBIN returned ${response.status}.`};
      if(new URL(response.url).pathname.replace(/\/$/,'')!==url.pathname.replace(/\/$/,''))return {url:url.href,fallback:true,verification:true,error:'FUTBIN redirected the squad page.'};
      const html=await response.text();
      if(/Just a moment|security verification|verify (?:that )?you are human|checking your browser/i.test(html.slice(0,1500)))return {url:url.href,fallback:true,verification:true,error:'FUTBIN is checking this browser.'};
      const doc=new DOMParser().parseFromString(html,'text/html');
      const script=doc.querySelector('script[data-react-data]');
      if(!script?.textContent)return {url:url.href,fallback:true,error:'FUTBIN did not include its embedded squad data.'};
      let data;
      try{data=JSON.parse(script.textContent);}catch{return {url:url.href,fallback:true,error:'FUTBIN embedded squad data could not be decoded.'};}
      const link=[...doc.querySelectorAll('a[href]')].find(anchor=>{
        try{const target=new URL(anchor.getAttribute('href'),url);return target.origin===url.origin&&/^\/27\/squad-building-challenges\/[^/]+\/\d+\//.test(target.pathname);}catch{return false;}
      });
      const challengeId=Number(link?.href.match(/challenges\/[^/]+\/(\d+)\//)?.[1]);
      if(!challengeId)return {url:url.href,fallback:true,error:'Waiting for the rendered SBC challenge link.'};
      if(challengeId!==expectedChallengeId)return {url:url.href,error:'FUTBIN squad has no matching challenge link.'};
      const formation=data?.sbcChallengeRequirementData?.formation?.positions;
      const entries=data?.squadData?.squad;
      if(!Array.isArray(formation)||!Array.isArray(entries))return {url:url.href,fallback:true,error:'FUTBIN squad data is incomplete.'};
      const positions=new Map();
      for(let index=0;index<formation.length-1;index++)if(/^cardlid\d+$/.test(formation[index]?.value||''))positions.set(formation[index].value,formation[index+1]?.value||'');
      const countRule=data.sbcChallengeRequirementData.requirements?.find(rule=>/\.PlayerCount$/.test(rule?.type||'')&&/\.Exactly$/.test(rule?.operator?.type||''));
      const requiredPlayers=Number.isSafeInteger(countRule?.value)&&countRule.value>0&&countRule.value<=positions.size?countRule.value:positions.size;
      const players=[];
      for(let index=0;index<entries.length;index++){
        const slot=entries[index]?.value;
        if(!positions.has(slot))continue;
        const item=entries[index+1];
        if(!item||item.value)return {url:url.href,incompleteSquad:true,error:`FUTBIN has an empty player in ${slot}.`};
        const baseURL=item.playerImage?.fixed?.url?.image1x||'';
        const cardURL=item.statsCard?.cardImage?.fixed?.url?.image1x||'';
        const id=Number(item.id?.playerCardId?.value);
        const attributes=['BasePace','BaseShooting','BasePassing','BaseDribbling','BaseDefending','BasePhysicality'].map(key=>Number(item.playerStats?.[key]));
        players.push({futbinSlot:Number(slot.slice(7)),slotPosition:positions.get(slot),name:item.statsCard?.title||item.playerName||'',baseId:Number(baseURL.match(/\/players\/(\d+)\.png/)?.[1]),rarity:Number(cardURL.match(/\/hd\/(\d+)[_.]/)?.[1]),rating:Number(item.playerRating),position:item.position?.value||'',clubId:Number(item.clubId?.value)||null,leagueId:Number(item.leagueId?.value)||null,nationId:Number(item.nationId?.value)||null,attributes:attributes.every(value=>Number.isSafeInteger(value)&&value>=0&&value<=99)?attributes:null,price:Number(item.price?.ps?.price),url:Number.isSafeInteger(id)&&id>0?`${url.origin}/27/player/${id}`:null});
      }
      if(players.length!==requiredPlayers)return {url:url.href,incompleteSquad:true,error:`FUTBIN has ${players.length}/${requiredPlayers} required players.`};
      if(players.some(player=>!Number.isSafeInteger(player.baseId)||player.baseId<1||!Number.isInteger(player.rarity)||player.rarity<0||!Number.isInteger(player.rating)||player.rating<1||!player.name||!player.position))return {url:url.href,fallback:true,error:'FUTBIN card identity is incomplete.'};
      if(players.some(player=>!Number.isSafeInteger(player.price)||player.price<1))return {url:url.href,fallback:true,error:'FUTBIN console player prices are incomplete.'};
      return {kind:'squad',year:27,market:'console',name:link.textContent.trim()||data.sbcChallengeRequirementData.challengeName||'SBC squad',challengeId,requiredPlayers,players,total:players.reduce((sum,player)=>sum+player.price,0),url:url.href,checkedAt:Date.now()};
    }catch(error){return {url:url.href,fallback:true,error:`FUTBIN page request failed: ${error.message}`};}
    finally{clearTimeout(timer);}
  };
  const results=[];
  let unavailable=false;
  for(const url of urls){
    // Stop the batch at a browser check or throttle instead of issuing a burst.
    if(unavailable){results.push({url,fallback:true,error:'Waiting for normal page navigation.'});continue;}
    const result=await readOne(url);
    results.push(result);
    unavailable=Boolean(result.verification);
  }
  return {kind:'batch',results};
}
