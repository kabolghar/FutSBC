import test from 'node:test';
import assert from 'node:assert/strict';
import {cardArtPage,readCardArt} from '../extension/card-art.js';

test('extracts only the exact FC 27 item artwork from its canonical player page',()=>{
  const page='https://www.fut.gg/players/231747-kylian-mbappe/27-231747/';
  const art='https://game-assets.fut.gg/cdn-cgi/image/quality=85,width=1200,format=auto/2027/player-item-social-small/27-231747.d6d9dcbc70eb755656958629bc654eabac73a925159f2f259474bb326e610168.webp';
  const html=`<img src="https://game-assets.fut.gg/2027/player-item-social-small/27-999999.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp"><meta property="og:image" content="${art}">`;
  assert.equal(cardArtPage(231747,231747),'https://www.fut.gg/players/231747/27-231747/');
  assert.equal(cardArtPage(231747,67340611),'https://www.fut.gg/players/231747/27-67340611/');
  assert.deepEqual(readCardArt(html,231747,231747,page),{assetId:231747,definitionId:231747,imageURL:art,pageURL:page,source:'FUT.GG FC 27 card image'});
  assert.throws(()=>readCardArt(html,231747,231747,'https://www.fut.gg/players/231747/27-999999/'),/did not match/);
  assert.throws(()=>readCardArt('unavailable',231747,231747,page),/exact FC 27/);
  assert.throws(()=>cardArtPage(231747,999999),/verified EA card ID/);
});
