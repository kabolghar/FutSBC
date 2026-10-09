// Read TanStack's serialized public loader data as literals. Never execute page scripts.
export function readGalleryLoader(html){
  const source=String(html||'');
  if(source.length>4_000_000)throw Error('The Gallery catalogue is too large to read safely.');
  if(!/FC 27/.test(source))throw Error('The provider did not return an FC 27 Gallery page.');
  const match=/\bl:\$R\[\d+\]=/.exec(source);
  if(!match)throw Error('Gallery data is unavailable. Retry later.');
  let at=match.index+match[0].length,steps=0;
  const refs=new Map(),space=()=>{while(/\s/.test(source[at]||'')&&at<source.length)at++;};
  function value(depth=0){
    if(++steps>100_000||depth>60)throw Error('Gallery data exceeds the supported limits.');
    space();const tail=source.slice(at);
    const ref=/^\$R\[(\d+)\]/.exec(tail);
    if(ref){at+=ref[0].length;space();const id=Number(ref[1]);if(source[at]==='='){at++;const result=value(depth+1);refs.set(id,result);return result;}if(!refs.has(id))throw Error('Gallery data contains an unknown reference.');return refs.get(id);}
    if(source[at]==='"'){
      const start=at++;let escaped=false;
      while(at<source.length){const c=source[at++];if(c==='"'&&!escaped)return JSON.parse(source.slice(start,at));escaped=c==='\\'&&!escaped;}
      throw Error('Gallery data contains an incomplete string.');
    }
    if(source[at]==='{'){
      at++;const object=Object.create(null);space();
      while(source[at]!=='}'){
        space();let key;
        if(source[at]==='"')key=value(depth+1);else{const token=/^(?:[a-zA-Z_$][\w$]*|\d+)/.exec(source.slice(at));if(!token)throw Error('Gallery data contains an unsupported key.');key=token[0];at+=key.length;}
        if(['__proto__','prototype','constructor'].includes(key))throw Error('Gallery data contains an unsafe key.');
        space();if(source[at++]!==':')throw Error('Gallery data is malformed.');object[key]=value(depth+1);space();
        if(source[at]===','){at++;continue;}if(source[at]!=='}')throw Error('Gallery data contains executable or unsupported content.');
      }
      at++;return object;
    }
    if(source[at]==='['){at++;const array=[];space();while(source[at]!==']'){array.push(value(depth+1));space();if(source[at]===','){at++;continue;}if(source[at]!==']')throw Error('Gallery array is malformed.');}at++;return array;}
    const literal=/^(null|true|false|!0|!1|-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)/i.exec(tail);
    if(!literal)throw Error('Gallery data contains executable or unsupported content.');
    at+=literal[0].length;const constants={null:null,true:true,false:false,'!0':true,'!1':false};return Object.hasOwn(constants,literal[0])?constants[literal[0]]:Number(literal[0]);
  }
  return value();
}

export function galleryURL(value){
  let url;try{url=new URL(value);}catch{throw Error('Use a FUT.GG Gallery set link.');}
  if(url.origin!=='https://www.fut.gg'||!/^\/fut-gallery\/[a-z0-9-]+\/[a-z0-9-]+\/$/.test(url.pathname)||url.search||url.hash)throw Error('Use a FUT.GG Gallery set link.');
  return url.href;
}

export function galleryPlan(data,url,grade='D',now=Date.now()){
  url=galleryURL(url);
  const set=data?.set,tier=data?.solution?.costTiers?.find(tier=>tier.grade===grade);
  if(!set||!Number.isSafeInteger(set.id)||!Number.isSafeInteger(set.requiredCards)||set.requiredCards<1||set.requiredCards>200||!Array.isArray(set.grades)||!set.grades.some(g=>g.name===grade))throw Error('The Gallery set requirements could not be read.');
  if(!tier||!['optimal','feasible'].includes(tier.status)||!Array.isArray(tier.items)||tier.items.length!==set.requiredCards)throw Error(`No complete ${grade} lineup is available for this set today.`);
  if(data.solution.setId!==set.id||!Number.isFinite(tier.totalScore)||!Number.isFinite(tier.threshold)||tier.threshold<0||tier.totalScore<tier.threshold||tier.threshold!==set.grades.find(g=>g.name===grade)?.threshold||!Number.isSafeInteger(tier.tokens)||tier.tokens<0)throw Error('The Gallery grade score does not match its requirements.');
  const details=new Map((data.lineupCards||[]).filter(card=>card.game==='27').map(card=>[card.eaId,card]));
  const seen=new Set();
  const players=tier.items.map(item=>{
    const id=Number(item.eaId),info=details.get(id)||{},price=Number(item.price);
    if(!Number.isSafeInteger(id)||id<1||seen.has(id)||!Number.isInteger(item.overall)||item.overall<1||item.overall>99||!Number.isSafeInteger(price)||price<150||price>15_000_000)throw Error('The Gallery lineup has missing prices or invalid cards.');
    if(set.clubEaId&&item.clubEaId!==set.clubEaId)throw Error('A Gallery card does not match the set club.');
    seen.add(id);
    if(!Number.isSafeInteger(item.playerEaId)||item.playerEaId<1||!Number.isInteger(item.rarityEaId)||item.rarityEaId<0||!Number.isFinite(item.score)||item.score<=0||!info.commonName||info.overall!==item.overall||info.loanDuration!=null||info.isEvolutionPlayerItem)throw Error('The Gallery card details are incomplete or ineligible.');
    const picture=typeof info.cardImageUrl==='string'&&/^https:\/\/game-assets\.fut\.gg\/.+\/2027\//.test(info.cardImageUrl)?info.cardImageUrl:null;
    return {definitionId:id,assetId:item.playerEaId,rating:item.overall,rarity:item.rarityEaId,score:item.score,name:info.commonName,position:info.positionNames?.[0]||'',picture,price,phase:'missing'};
  });
  const computedAt=Date.parse(data.solution.computedAt);
  if(!Number.isFinite(computedAt)||computedAt>now+60_000||now-computedAt>24*60*60_000)throw Error('The Gallery lineup prices are stale. Retry after FUT.GG updates this set.');
  return {id:crypto.randomUUID(),url,setId:set.id,name:set.name,description:set.description,requiredCards:set.requiredCards,grade,grades:set.grades.map(g=>({name:g.name,threshold:g.threshold})),players,checkedAt:now,computedAt,source:'FUT.GG',estimatedScore:tier.totalScore,tokens:tier.tokens,estimatedTotal:players.reduce((sum,p)=>sum+p.price,0),status:'Check club cards to find what is missing.'};
}

export function galleryDirectory(data){
  const categories=data?.listing?.categories;
  if(!Array.isArray(categories))throw Error('The Gallery catalogue is unavailable.');
  return categories.flatMap(category=>(category.sets||[]).map(set=>({id:set.id,name:set.name,category:category.name,requiredCards:set.requiredCards,url:galleryURL(`https://www.fut.gg/fut-gallery/${category.slug}/${set.slug}/`)})));
}

export function galleryCollectionKey(accountKey){if(typeof accountKey!=='string'||!accountKey.trim()||accountKey.length>160)throw Error('EA did not identify the selected club.');return `futsbc-gallery-collected:${accountKey}`;}
export function galleryRemaining(plan){return (plan?.players||[]).filter(p=>!['owned','collected','in-club'].includes(p.phase));}
export function galleryCaps(plan,budget,caps={}){
  if(!Number.isSafeInteger(budget)||budget<0)throw Error('Enter a valid total Gallery budget.');
  const players=galleryRemaining(plan).map(p=>({...p,maxPrice:Number(caps[p.definitionId]??p.price)}));
  if(players.some(p=>!Number.isSafeInteger(p.maxPrice)||p.maxPrice<150||p.maxPrice>15_000_000))throw Error('Every missing card needs a valid maximum price.');
  if(players.reduce((n,p)=>n+p.maxPrice,0)>budget)throw Error('The card price limits exceed your total Gallery budget.');
  return players;
}
