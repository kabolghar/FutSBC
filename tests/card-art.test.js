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

test('prefers the full portrait card over a social preview of the same exact item',()=>{
  const page='https://www.fut.gg/players/70006/27-70006/';
  const portrait='https://game-assets.fut.gg/cdn-cgi/image/quality=85,format=auto,width=300/2027/futgg-player-item-card/27-70006.aedf9b41a088c66eed720ea754e82fd12c3026b94eac3583e84ffc160587c88d.webp';
  const social='https://game-assets.fut.gg/2027/player-item-social-small/27-70006.0b148752a0ce31ffd802896034ea07caa3fb014f3a5948e24ad0a285501284ed.webp';
  const wrong='https://game-assets.fut.gg/2027/futgg-player-item-card/27-70018.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp';
  assert.equal(readCardArt(`${social} ${wrong} ${portrait}`,70006,70006,page).imageURL,portrait);
  const alternate=portrait.replace('futgg-player-item-card','player-item-card');
  assert.equal(readCardArt(`${social} ${alternate}`,70006,70006,page).imageURL,alternate);
});
