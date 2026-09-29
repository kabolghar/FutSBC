import test from 'node:test';
import assert from 'node:assert/strict';
import {teamLinkPages,teamCandidatePool,linkedTeamOptions} from '../extension/team-links.js';
test('link searches cover nation and league separately, plus club, within the future budget',()=>{
 const urls=teamLinkPages(150000,[{nationId:52,leagueId:39,clubId:112893},{nationId:52,leagueId:39}]);
 assert.equal(urls.length,6);
 assert(urls.some(url=>url.includes('nation=52&')));assert(urls.some(url=>url.includes('league=39&')));
 for(const raw of urls){const url=new URL(raw);assert.equal(url.searchParams.get('ps_price'),'0-150000');assert(!(url.searchParams.has('nation')&&url.searchParams.has('league')));}
});
test('strong links survive generic ranks; weak cards are never promoted for their badge',()=>{
 const general=Array.from({length:60},(_,i)=>({assetId:i+1,definitionId:i+1,rating:85,source:'FUT.GG',metaRank:i+1}));
 const linked=[{assetId:90,definitionId:90,rating:84,futbinRating:87,price:25000},{assetId:91,definitionId:91,rating:54,futbinRating:95,price:200},{assetId:92,definitionId:92,rating:89,futbinRating:60,price:1000}];
 const pool=teamCandidatePool(general,linked);assert.equal(pool.length,48);assert(pool.some(card=>card.assetId===90));assert(!pool.some(card=>[91,92].includes(card.assetId)));
 const options=[...general,{...linked[0],nationId:52,leagueId:13}];
 const shortlist=linkedTeamOptions(options,[{nationId:52,leagueId:39}]);assert.equal(shortlist[0].assetId,90);assert.equal(shortlist.length,48);assert(shortlist.some(card=>card.assetId===1));
});
