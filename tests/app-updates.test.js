import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source = readFileSync(new URL('../public/app-updates.js', import.meta.url),'utf8');
function setup() {
  const mod = {exports:{}};
  vm.runInNewContext(source,{module:mod, AbortController, Date});
  const made=[];
  function element(tag) { return {tag,children:[],listeners:{},append(...nodes){this.children.push(...nodes);},setAttribute(){},addEventListener(name,fn){this.listeners[name]=fn;},remove(){this.removed=true;}}; }
  const doc={documentElement:{dataset:{appRevision:'old'}},head:element('head'),body:element('body'),hidden:false,createElement:tag=>{const node=element(tag);made.push(node);return node;},addEventListener(){},removeEventListener(){}};
  const env={document:doc,navigator:{onLine:true},setInterval:()=>1,clearInterval(){},setTimeout,clearTimeout,addEventListener(){},removeEventListener(){},location:{reload(){env.reloads++;}},reloads:0,calls:0,revision:'old'};
  env.fetch=async()=>{env.calls++;return{ok:true,json:async()=>({revision:env.revision})};};
  const client=mod.exports(env);return{env,doc,made,client};
}
const settle=()=>new Promise(r=>setImmediate(r));
test('new deployments offer reload without discarding current work',async()=>{
 const {env,doc,made,client}=setup();await settle();env.revision='new';await client.check(true);
 assert.equal(doc.documentElement.dataset.appUpdate,'available');assert.equal(doc.body.children.length,1);assert.equal(env.reloads,0);
 made.find(e=>e.textContent==='Reload when ready').listeners.click();assert.equal(env.reloads,1);
 await client.check(true);assert.equal(doc.body.children.length,1);client.stop();
});
test('offline, hidden and stopped pages do not poll',async()=>{
 const {env,doc,client}=setup();await settle();const count=env.calls;
 doc.hidden=true;await client.check(true);doc.hidden=false;env.navigator.onLine=false;await client.check(true);
 env.navigator.onLine=true;client.stop();await client.check(true);assert.equal(env.calls,count);
});
test('overlapping checks coalesce and temporary failures preserve the page',async()=>{
 const {env,doc,client}=setup();await settle();let done;
 env.fetch=()=>{env.calls++;return new Promise(r=>{done=r;});};
 const check=client.check(true);await client.check(true);done({ok:false});await check;
 assert.equal(doc.body.children.length,0);assert.equal(env.calls,2);
 env.fetch=async()=>{throw new Error('offline');};await client.check(true);assert.equal(env.reloads,0);client.stop();
});
