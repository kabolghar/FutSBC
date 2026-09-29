import test from 'node:test';
import assert from 'node:assert/strict';
import {futggBestURL,readFutggBest,selectFutggTeamPlayers} from '../extension/futgg-team.js';

test('reads ranked FC 27 cards by exact item ID without treating the ranking as a price',()=>{
  const url=futggBestURL('ST');
  const rows=[89,88,86,82,78,54].map((rating,index)=>({
    textContent:`#${index+1} Player ${index}`,
    getAttribute:()=>`/players/${100+index}-player-${index}/27-${100+index}/`,
    querySelector:selector=>selector==='img[alt]'?{getAttribute:()=>`Player ${index} - ${rating} - Rare`}:{textContent:`Player ${index}`}
  }));
  globalThis.location={href:url};globalThis.document={title:'Best Cheap Strikers in EA FC 27 (Under 50K) - FUT.GG',querySelectorAll:()=>rows};
  const page=readFutggBest(url);
  assert.equal(page.kind,'futgg-best');
  assert.equal(page.cards.length,5);
  assert.deepEqual(page.cards[0],{assetId:100,definitionId:100,rating:89,name:'Player 0',url:'https://www.fut.gg/players/100-player-0/27-100/',metaRank:1,source:'FUT.GG',price:null});
  assert.deepEqual(selectFutggTeamPlayers(page,[100]).map(card=>card.assetId),[101,102,103,104]);
  assert.equal(futggBestURL('CF'),'https://www.fut.gg/players/best/cheap/st/');
});

test('rejects ranking cards with a missing or unreadable rating',()=>{
  const url=futggBestURL('GK');
  const rows=Array.from({length:6},(_,index)=>({
    textContent:`#${index+1} Player ${index}`,
    getAttribute:()=>`/players/${200+index}-player-${index}/27-${200+index}/`,
    querySelector:selector=>selector==='img[alt]'?{getAttribute:()=>index===0?'Player image':`Player ${index} - 8${index} - Rare`}:{textContent:`Player ${index}`}
  }));
  globalThis.location={href:url};globalThis.document={title:'Best Cheap GKs in EA FC 27 (Under 50K) - FUT.GG',querySelectorAll:()=>rows};
  const page=readFutggBest(url);
  assert.equal(page.kind,'futgg-best');
  assert.equal(page.cards.length,5);
  assert.equal(page.cards.some(card=>card.assetId===200),false);
});


test('does not invent a meta rank from unrelated page card order',()=>{
 const url=futggBestURL('ST');
 globalThis.location={href:url};
 globalThis.document={title:'Best Cheap Strikers in EA FC 27',querySelectorAll:()=>Array.from({length:6},(_,index)=>({textContent:'Unranked player',getAttribute:()=>`/players/${index+1}-card/27-${index+1}/`,querySelector:s=>s==='img[alt]'?{getAttribute:()=> 'Card - 85 - Rare'}:{textContent:'Card'}}))};
 assert.match(readFutggBest(url).error,/enough verified/);
});
