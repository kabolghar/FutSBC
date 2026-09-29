export const FUTBIN_NEWS_URL='https://www.futbin.com/news';

export function readFutbinHeadlines(){
  if(location.origin!=='https://www.futbin.com'||location.pathname!=='/news')return {error:'Waiting for FUTBIN news.'};
  const body=(document.body?.innerText||'').slice(0,600);
  if(/Just a moment|security verification|verify (?:that )?you are human|checking your browser/i.test(document.title+' '+body))return {error:'FUTBIN requires browser verification for news.',blocked:true};
  const rows=[],seen=new Set();
  for(const anchor of document.querySelectorAll('a[href*="/news/articles/"]')){
    const url=new URL(anchor.getAttribute('href'),location.origin);
    if(url.origin!==location.origin||!/^\/news\/articles\/\d+\//.test(url.pathname)||seen.has(url.pathname))continue;
    const title=(anchor.querySelector('h2,h3,h4')?.textContent||anchor.textContent||'').replace(/\s+/g,' ').trim();
    if(title.length<12||title.length>170)continue;
    const nearby=(anchor.closest('article')||anchor.parentElement?.parentElement||anchor).textContent||'';
    const date=nearby.match(/\b(\d{1,2})-([A-Za-z]{3})-(\d{2})\b/);
    const at=date?Date.parse(`${date[1]} ${date[2]} 20${date[3]} UTC`):null;
    rows.push({title,url:url.href,at:Number.isFinite(at)?at:null});seen.add(url.pathname);
    if(rows.length>=12)break;
  }
  return rows.length?{kind:'news',checkedAt:Date.now(),url:location.href,headlines:rows}:{error:'FUTBIN news headlines did not load.'};
}
