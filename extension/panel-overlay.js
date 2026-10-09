// Self-contained for chrome.scripting.executeScript in Arc and other browsers
// without Chrome's native sidePanel API.
export function openOverlay({initiallyOpen=true,replace=true}={}) {
  const id='futsbc-companion-panel';
  const previous=document.getElementById(id);
  // A previous iframe may have a dead runtime after an extension reload.
  if(previous&&!replace)return;
  if(previous){previous.dispatchEvent(new Event('futsbc-dispose'));previous.remove();}

  const host=document.createElement('div');
  host.id=id;
  host.style.cssText='position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
  const shadow=host.attachShadow({mode:'closed'});
  const style=document.createElement('style');
  style.textContent=`
    :host{all:initial}
    *{box-sizing:border-box}
    [hidden]{display:none!important}
    button{font-family:system-ui,sans-serif;cursor:pointer}
    button:focus-visible{outline:2px solid oklch(83% .13 112);outline-offset:2px}
    .launcher{position:fixed;right:12px;bottom:12px;width:52px;height:58px;display:grid;place-items:center;padding:3px;border:0;border-radius:12px;background:transparent;color:oklch(83% .13 112);filter:drop-shadow(0 4px 7px oklch(7% .005 115 / .5));pointer-events:auto;transition:transform 160ms ease,color 160ms ease}
    .launcher svg{display:block;width:44px;height:52px;pointer-events:none}
    .launcher:hover{color:oklch(92% .11 112);transform:translateY(-2px)}
    .launcher:active{transform:translateY(0)}
    @media(prefers-reduced-motion:reduce){.launcher{transition:none}.launcher:hover{transform:none}}
    .backdrop{position:fixed;inset:0;background:oklch(7% .005 115 / .65);pointer-events:auto}
    .modal{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(560px,calc(100vw - 24px));height:390px;max-height:calc(100dvh - 24px);overflow:hidden;border:1px solid oklch(34% .014 115);border-radius:12px;background:oklch(17% .009 115);box-shadow:0 16px 48px oklch(7% .005 115 / .55);pointer-events:auto}
    .modal[data-view="lineup"]{width:min(760px,calc(100vw - 40px))}
    .modal[data-view="trader"]{width:min(600px,calc(100vw - 40px))}
    .modal[data-view="market"]{width:min(920px,calc(100vw - 40px))}
    .modal[data-view="team"]{width:min(920px,calc(100vw - 40px))}
    .modal[data-view="gallery"]{width:min(740px,calc(100vw - 40px))}
    .modal:focus{outline:none}
    .close{position:absolute;top:23px;right:12px;z-index:1;width:36px;height:36px;border:1px solid oklch(34% .014 115);border-radius:8px;background:oklch(21% .012 115);color:oklch(92% .012 105);font-size:20px;line-height:1}
    .close:hover{border-color:oklch(83% .13 112)}
    iframe{display:block;width:100%;height:100%;border:0;background:oklch(17% .009 115)}
    @media(max-width:480px){.modal,.modal[data-view="lineup"],.modal[data-view="trader"],.modal[data-view="market"],.modal[data-view="team"],.modal[data-view="gallery"]{width:calc(100vw - 12px);max-height:calc(100dvh - 12px)}}
  `;

  const launcher=document.createElement('button');
  launcher.className='launcher';
  launcher.type='button';
  launcher.innerHTML='<svg viewBox="0 0 48 56" aria-hidden="true" focusable="false"><path d="M7 3h34l4 4v25c0 9-12 17-21 21C15 49 3 41 3 32V7Z" fill="#101109" stroke="currentColor" stroke-width="2"/><path d="M12 12h25l-4 6H19v5h12l-4 6h-8v9l-7-4Z" fill="currentColor"/><path d="m27 34 3-3 3 3-3 3Zm-6 7 3-3 3 3-3 3Zm12-1 3-3 3 3-3 3Z" fill="currentColor"/></svg>';
  launcher.title='Open FutSBC';
  launcher.setAttribute('aria-label','Open FutSBC menu');

  const backdrop=document.createElement('div');
  backdrop.className='backdrop';
  backdrop.setAttribute('aria-hidden','true');

  const modal=document.createElement('div');
  modal.className='modal';
  modal.setAttribute('role','dialog');
  modal.setAttribute('aria-modal','true');
  modal.setAttribute('aria-label','FutSBC menu');
  modal.tabIndex=-1;
  const close=document.createElement('button');
  close.className='close';
  close.type='button';
  close.textContent='×';
  close.setAttribute('aria-label','Collapse FutSBC to icon');
  const frame=document.createElement('iframe');
  frame.src=chrome.runtime.getURL('panel.html');
  frame.title='FutSBC companion menu';
  modal.append(frame,close);
  shadow.append(style,launcher,backdrop,modal);
  document.body.append(host);

  function setOpen(open,focus=true){
    launcher.hidden=open;
    backdrop.hidden=!open;
    modal.hidden=!open;
    if(focus){if(open)modal.focus();else launcher.focus();}
  }
  launcher.addEventListener('click',()=>setOpen(true));
  close.addEventListener('click',()=>setOpen(false));
  backdrop.addEventListener('click',()=>setOpen(false));
  const onKeyDown=event=>{if(event.key==='Escape'&&!modal.hidden)setOpen(false);};
  const panelOrigin=new URL(frame.src).origin;
  const onSize=event=>{
    if(event.source!==frame.contentWindow||event.origin!==panelOrigin||event.data?.type!=='futsbc-panel-size')return;
    modal.dataset.view=['menu','lineup','trader','market','team','gallery'].includes(event.data.view)?event.data.view:event.data.hasResult?'lineup':'menu';
    modal.setAttribute('aria-label',modal.dataset.view==='gallery'?'FutSBC Gallery collector':modal.dataset.view==='trader'?'FutSBC auto trader':modal.dataset.view==='market'?'FutSBC market brief':modal.dataset.view==='team'?'FutSBC team upgrades':'FutSBC menu');
    const height=Number(event.data.height);
    if(Number.isFinite(height))modal.style.height=`${Math.max(220,Math.min(Math.ceil(height),window.innerHeight-24))}px`;
  };
  document.addEventListener('keydown',onKeyDown);
  window.addEventListener('message',onSize);
  host.addEventListener('futsbc-dispose',()=>{document.removeEventListener('keydown',onKeyDown);window.removeEventListener('message',onSize);});
  setOpen(initiallyOpen,initiallyOpen);
}
