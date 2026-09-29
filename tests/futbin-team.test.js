import test from 'node:test';
import assert from 'node:assert/strict';
import {teamPlayerPages,readFutbinTeamPlayers,selectTeamPlayers} from '../extension/futbin-team.js';

const url='https://www.futbin.com/27/players?page=1&ps_price=0-5000';
const node=textContent=>({textContent});
const player=(id,link,name,rating,position,price,fit,revision='Normal')=>{
  const cells=[node(`${name} ${revision}`),node(String(rating)),node(position),node(price),node(String(fit)),node('149')];
  const anchor={textContent:name,getAttribute:()=>`/27/player/${link}/${name.toLowerCase().replaceAll(' ','-')}`};
  const image={getAttribute:()=>`https://cdn3.futbin.com/content/fifa27/img/players/${id}.png`};
  return {querySelectorAll:selector=>selector==='td'?cells:[],querySelector:selector=>selector.startsWith('a[')?anchor:selector.startsWith('img[')?image:null};
};
const rows=[player(111,90,'Player One',84,'CB','1.8K',82.1),player(112,91,'Player Two',82,'CB, RB','650',85.5),player(113,92,'Player Three',91,'ST','4K',90),player(114,93,'Player Four',85,'CB','2K',89,'Special')];
function setup(blocked=false){
  const headings=['NAME','RAT','POS','PRICE','FUTBIN RATING','POP'].map(node);
  const table={querySelectorAll:selector=>selector==='thead th'?headings:selector==='tbody tr'?rows:[]};
  globalThis.location={href:url};
  globalThis.document={title:blocked?'Just a moment...':'EA FC 27 Players',body:{innerText:blocked?'Checking your browser':'EA FC 27 players'},querySelectorAll:selector=>selector==='table'?[table]:[]};
}

test('reads position, console price, and FUTBIN rating from a verified FC 27 table',()=>{
  setup();const page=readFutbinTeamPlayers(url);
  assert.equal(page.kind,'team-players');
  assert.deepEqual(page.cards.map(card=>card.assetId),[111,112,113]);
  assert.deepEqual(page.cards[1].positions,['CB','RB']);
  assert.equal(page.cards[0].futbinRating,82.1);
  assert.equal(page.cards[0].price,1800);
  assert.match(readFutbinTeamPlayers(url.replace('page=1','page=2')).error,/Waiting/);
  assert.match(readFutbinTeamPlayers(url+'&nation=52').error,/Waiting/);
  globalThis.location.href=url+'&nation=52';assert.equal(readFutbinTeamPlayers(location.href).kind,'team-players');
  assert.match(readFutbinTeamPlayers(url+'&league=39').error,/Waiting/);
});

test('selects exact affordable position fits and excludes cards in the squad',()=>{
  setup();const page=readFutbinTeamPlayers(url);
  page.cards.push({assetId:999,revision:'Normal',rating:54,positions:['CB'],price:500,futbinRating:99,url:'https://www.futbin.com/27/player/999/bronze'});
  page.cards.push({assetId:998,revision:'Normal',rating:80,positions:['CB'],price:500,futbinRating:62,url:'https://www.futbin.com/27/player/998/poor-fit'});
  assert.deepEqual(selectTeamPlayers([page],'CB',2000,[]).map(card=>card.assetId),[112,111]);
  assert.deepEqual(selectTeamPlayers([page],'CB',2000,[112]).map(card=>card.assetId),[111]);
  assert.deepEqual(selectTeamPlayers([page],'ST',2000,[]),[]);
  assert.deepEqual(teamPlayerPages(10000).map(value=>new URL(value).searchParams.get('ps_price')),['0-5000','0-5000','0-5000','5000-10000']);
});

test('fails closed on browser checks and unsupported tables',()=>{
  setup(true);assert.equal(readFutbinTeamPlayers(url).blocked,true);
  globalThis.document.title='FC 27 Players';globalThis.document.body.innerText='EA FC 27 players';globalThis.document.querySelectorAll=()=>[];
  assert.match(readFutbinTeamPlayers(url).error,/supported/);
});
