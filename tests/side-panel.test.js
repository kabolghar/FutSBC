import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {openOverlay} from '../extension/panel-overlay.js';

test('toolbar popup launches an Arc companion panel with a tab fallback',async()=>{
  const m=JSON.parse(await readFile(new URL('../extension/manifest.json',import.meta.url)));
  assert.equal(m.manifest_version,3);
  assert.ok(m.permissions.includes('sidePanel'));
  assert.equal(m.side_panel.default_path,'panel.html');
  assert.equal(m.action.default_popup,'open.html');
  assert.equal(m.options_page,'panel.html');
  assert.ok(m.web_accessible_resources.some(item=>item.resources.includes('panel.html')&&item.matches.includes('https://www.ea.com/*')));
  const panel=await readFile(new URL('../extension/panel.html',import.meta.url),'utf8');
  assert.match(panel,/id="trader-tab"/);
  assert.match(panel,/id="trader-toggle"/);
  const launcher=await readFile(new URL('../extension/open.js',import.meta.url),'utf8');
  assert.match(launcher,/func:openOverlay/);
  assert.match(launcher,/currentWindow:true/);
  const html=await readFile(new URL('../extension/open.html',import.meta.url),'utf8');
  assert.match(html,/href="panel.html"/);
});

test('menu collapses to a launcher, reopens, and replaces a stale iframe',()=>{
  const originalDocument=globalThis.document;
  const originalChrome=globalThis.chrome;
  const originalWindow=globalThis.window;
  const children=[];
  const documentListeners=new Map();
  const windowListeners=new Map();
  const makeElement=()=>{
    const listeners=new Map();
    return {
      style:{},dataset:{},children:[],hidden:false,
      append(...items){this.children.push(...items);},
      attachShadow(){this.shadow=makeElement();return this.shadow;},
      setAttribute(){},focus(){},
      addEventListener(type,handler){listeners.set(type,handler);},
      dispatchEvent(event){listeners.get(event.type)?.(event);},
      remove(){const index=children.indexOf(this);if(index>=0)children.splice(index,1);}
    };
  };
  globalThis.document={
    getElementById:id=>children.find(item=>item.id===id),
    createElement:makeElement,
    body:{append:item=>children.push(item)},
    addEventListener(type,handler){documentListeners.set(type,handler);},
    removeEventListener(type){documentListeners.delete(type);}
  };
  globalThis.chrome={runtime:{getURL:path=>`chrome-extension://test/${path}`}};
  globalThis.window={
    innerHeight:800,
    addEventListener(type,handler){windowListeners.set(type,handler);},
    removeEventListener(type){windowListeners.delete(type);}
  };
  try{
    openOverlay({initiallyOpen:false,replace:false});
    const first=children[0];
    const [,launcher,backdrop,modal]=first.shadow.children;
    const [frame,close]=modal.children;
    assert.equal(launcher.hidden,false);
    assert.equal(modal.hidden,true);
    openOverlay({initiallyOpen:false,replace:false});
    assert.equal(children[0],first);
    launcher.dispatchEvent({type:'click'});
    windowListeners.get('message')({source:frame.contentWindow,origin:new URL(frame.src).origin,data:{type:'futsbc-panel-size',height:420,hasResult:true}});
    assert.equal(modal.style.height,'420px');
    assert.equal(modal.dataset.view,'lineup');
    windowListeners.get('message')({source:frame.contentWindow,origin:new URL(frame.src).origin,data:{type:'futsbc-panel-size',height:310,hasResult:false}});
    assert.equal(modal.dataset.view,'menu');
    windowListeners.get('message')({source:frame.contentWindow,origin:new URL(frame.src).origin,data:{type:'futsbc-panel-size',height:560,view:'trader'}});
    assert.equal(modal.dataset.view,'trader');
    assert.equal(modal.style.height,'560px');
    assert.equal(launcher.hidden,true);
    assert.equal(modal.hidden,false);
    close.dispatchEvent({type:'click'});
    assert.equal(launcher.hidden,false);
    assert.equal(backdrop.hidden,true);
    assert.equal(modal.hidden,true);
    launcher.dispatchEvent({type:'click'});
    assert.equal(modal.hidden,false);
    documentListeners.get('keydown')({key:'Escape'});
    assert.equal(modal.hidden,true);
    launcher.dispatchEvent({type:'click'});
    backdrop.dispatchEvent({type:'click'});
    assert.equal(modal.hidden,true);
    openOverlay();
    assert.equal(children.length,1);
    assert.notEqual(children[0],first);
    assert.equal(documentListeners.size,1);
    assert.equal(windowListeners.size,1);
  }finally{
    globalThis.document=originalDocument;
    globalThis.chrome=originalChrome;
    globalThis.window=originalWindow;
  }
});
