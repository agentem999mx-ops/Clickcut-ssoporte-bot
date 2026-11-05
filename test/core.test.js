import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db.js';
import { inbound,enqueue } from '../src/domain.js';
import { drain,createCloud } from '../src/cloud.js';
import { validSignature,passwordHash,passwordValid,mayEdit,token,hash } from '../src/security.js';
import { minimalAvailability,minimalAssignment,AccessControlPort } from '../src/access-control.js';
import { createApp } from '../src/server.js';
import { config } from '../src/config.js';
import { groupDb,groupMessage,runJobs,validateGroups } from '../groups/core.js';
const now=1800000000000;
const message=(id,text,from='5215555555555',time=now)=>({id,from,timestamp:String(Math.floor(time/1000)),type:'text',text:{body:text}});
function fixture(){const db=openDb(':memory:');db.prepare("INSERT INTO products VALUES('test','Producto de prueba',19900,'MXN',1)").run();return db;}
function customer(db,wa='5215555555555'){return db.prepare('SELECT * FROM customers WHERE wa_id=?').get(wa);}
test('tickets persist, duplicate webhook cannot duplicate ticket or reply',()=>{
  const db=fixture();assert.equal(inbound(db,message('a','TICKET Servicio con error'),now),true);assert.equal(inbound(db,message('a','TICKET Servicio con error'),now),false);
  assert.equal(db.prepare('SELECT count(*) n FROM tickets').get().n,1);assert.equal(db.prepare('SELECT count(*) n FROM outbox').get().n,1);db.close();
});
test('SQLite survives close and reopen',()=>{
  const dir=mkdtempSync(join(tmpdir(),'clickcut-')),path=join(dir,'db.sqlite');let db=openDb(path);
  inbound(db,message('p','TICKET Error persistente'),now);db.close();db=openDb(path);assert.equal(db.prepare('SELECT count(*) n FROM tickets').get().n,1);db.close();rmSync(dir,{recursive:true});
});
test('order snapshots price; renewals require completed own order',()=>{
  const db=fixture();inbound(db,message('a','PEDIR test'),now);const order=db.prepare('SELECT * FROM orders').get();assert.equal(order.price_cents,19900);
  inbound(db,message('b',`RENOVAR ${order.id}`,'5211111111111'),now);assert.equal(db.prepare('SELECT count(*) n FROM orders').get().n,1);
  db.prepare("UPDATE orders SET status='completed'").run();db.prepare('UPDATE products SET price_cents=21000').run();
  inbound(db,message('c',`RENOVAR ${order.id}`),now);const renewal=db.prepare("SELECT * FROM orders WHERE kind='renewal'").get();assert.equal(renewal.price_cents,21000);assert.equal(renewal.reference,order.id);db.close();
});
test('status queries do not disclose another customer',()=>{
  const db=fixture();inbound(db,message('a','TICKET Error test'),now);const id=db.prepare('SELECT id FROM tickets').get().id;
  inbound(db,message('b',`ESTADO ${id}`,'5211111111111'),now);const row=db.prepare('SELECT payload FROM outbox WHERE customer_id=?').get(customer(db,'5211111111111').id);assert.match(JSON.parse(row.payload).text,/no disponible/);db.close();
});
test('human handoff creates ticket and silences automation',()=>{
  const db=fixture();inbound(db,message('a','HUMANO'),now);assert.equal(customer(db).human,1);inbound(db,message('b','PEDIR test'),now);assert.equal(db.prepare('SELECT count(*) n FROM orders').get().n,0);assert.equal(db.prepare('SELECT count(*) n FROM tickets').get().n,1);db.close();
});
test('opt-out blocks queued messages and ALTA restores consent',()=>{
  const db=fixture();inbound(db,message('a','hola'),now);inbound(db,message('b','BAJA'),now);assert.equal(customer(db).opted_out,1);assert.equal(db.prepare('SELECT state FROM outbox').get().state,'blocked');inbound(db,message('c','PEDIR test'),now);assert.equal(db.prepare('SELECT count(*) n FROM orders').get().n,0);inbound(db,message('d','ALTA'),now);assert.equal(customer(db).opted_out,0);db.close();
});
test('expired replay cannot reopen service window',async()=>{
  const db=fixture();inbound(db,message('a','hola','5215555555555',now-86401000),now);let calls=0;await drain(db,async()=>{calls++;return 'x';},now);assert.equal(calls,0);assert.equal(db.prepare('SELECT state FROM outbox').get().state,'blocked');db.close();
});
test('outbox successful delivery and 429 backoff',async()=>{
  const db=fixture();inbound(db,message('a','hola'),now);await drain(db,async()=>{throw Object.assign(Error(),{status:429});},now);assert.equal(db.prepare('SELECT state FROM outbox').get().state,'pending');await drain(db,async()=> 'wamid.test',now+60001);assert.equal(db.prepare('SELECT provider_id FROM outbox').get().provider_id,'wamid.test');db.close();
});
test('ambiguous timeout is held without automatic resend',async()=>{
  const db=fixture();inbound(db,message('a','hola'),now);let calls=0;await drain(db,async()=>{calls++;throw Error('timeout');},now);await drain(db,async()=>{calls++;},now+600000);assert.equal(calls,1);assert.equal(db.prepare('SELECT state FROM outbox').get().state,'unknown');db.close();
});
test('templates may send outside window but never to opted-out customer',async()=>{
  const db=fixture();inbound(db,message('a','hola','5215555555555',now-90000000),now);const c=customer(db);enqueue(db,c.id,{type:'template',name:'test',language:'es_MX'},now);let calls=0;await drain(db,async()=>{calls++;return 'template-id';},now);assert.equal(calls,1);db.prepare('UPDATE customers SET opted_out=1').run();enqueue(db,c.id,{type:'template',name:'test',language:'es_MX'},now);await drain(db,async()=>{calls++;},now);assert.equal(calls,1);db.close();
});
test('signature over raw bytes and password checks',()=>{
  const raw=Buffer.from('{"x":1}'),secret='synthetic-test-secret',sig='sha256='+createHmac('sha256',secret).update(raw).digest('hex');assert.ok(validSignature(raw,sig,secret));assert.ok(!validSignature(Buffer.from('{}'),sig,secret));assert.ok(!validSignature(raw,sig,''));const p=passwordHash('synthetic-password-1234');assert.ok(passwordValid('synthetic-password-1234',p));assert.ok(!passwordValid('wrong',p));
});
test('staff scope is assigned work only',()=>{assert.ok(mayEdit({id:'a',role:'staff'},{assignee:'a'}));assert.ok(!mayEdit({id:'a',role:'staff'},{assignee:'b'}));assert.ok(!mayEdit({id:'a',role:'staff'},{assignee:null}));assert.ok(mayEdit({id:'a',role:'owner'},{assignee:null}));});
test('future integration strips every unapproved field',async()=>{
  assert.deepEqual(minimalAvailability({product_id:'p',available:true,password:'secret',email:'x'}),{product_id:'p',available:true});assert.deepEqual(minimalAssignment({external_ref:'x',status:'active',expires_at:null,password:'x'}),{external_ref:'x',status:'active',expires_at:null});await assert.rejects(new AccessControlPort().availability('p'));
});
test('Graph payload and error redaction',async()=>{
  const cfg={enabled:true,version:'v99.0',phoneId:'123',token:'synthetic'};let seen;
  const send=createCloud(cfg,async(url,options)=>{seen={url,options};return {ok:true,json:async()=>({messages:[{id:'wamid.1'}]})};});assert.equal(await send('55555',{type:'text',text:'hola'}),'wamid.1');assert.equal(JSON.parse(seen.options.body).messaging_product,'whatsapp');assert.match(seen.url,/graph.facebook.com/);
  await assert.rejects(createCloud(cfg,async()=>({ok:false,status:400}))('55555',{type:'text',text:'x'}),/Provider rejected/);
});
test('configuration fails closed',()=>{assert.throws(()=>config({CLOUD_ENABLED:'true'}));assert.throws(()=>config({NODE_ENV:'production'}));assert.equal(config({}).enabled,false);});

const gc={groups:[{jid:'123@g.us',staffJids:['1@s.whatsapp.net'],rules:'Reglas',privateContact:'Privado oficial'}]};
function gm(id,text,sender='1@s.whatsapp.net',jid='123@g.us',time=now){return {key:{id,remoteJid:jid,participant:sender},message:{conversation:text},messageTimestamp:time/1000};}
function socket(admin=true,botAdmin=true){const calls=[];return {calls,user:{id:'2:7@s.whatsapp.net'},groupMetadata:async()=>({participants:[{id:'1@s.whatsapp.net',admin:admin?'admin':null},{id:'2@s.whatsapp.net',admin:botAdmin?'admin':null},{id:'3@s.whatsapp.net',admin:'admin'}]}),sendMessage:async(...x)=>calls.push(x),groupSettingUpdate:async(...x)=>calls.push(x)};}
test('groups require allowlist plus current admin plus bot admin',async()=>{
  for(const [admin,botAdmin,sender,expected] of [[true,true,'1@s.whatsapp.net',1],[false,true,'1@s.whatsapp.net',0],[true,false,'1@s.whatsapp.net',0],[true,true,'3@s.whatsapp.net',0]]){const db=groupDb(':memory:'),sock=socket(admin,botAdmin);await groupMessage(sock,db,gc,gm('a','.cerrar',sender),now);assert.equal(sock.calls.length,expected);db.close();}
});
test('groups ignore private, unknown groups, old history and duplicates',async()=>{
  const db=groupDb(':memory:'),sock=socket();await groupMessage(sock,db,gc,gm('a','.cerrar','1@s.whatsapp.net','1@s.whatsapp.net'),now);await groupMessage(sock,db,gc,gm('b','.cerrar','1@s.whatsapp.net','999@g.us'),now);await groupMessage(sock,db,gc,gm('c','.cerrar','1@s.whatsapp.net','123@g.us',now-600000),now);assert.equal(sock.calls.length,0);await groupMessage(sock,db,gc,gm('d','.cerrar'),now);await groupMessage(sock,db,gc,gm('d','.cerrar'),now+20000);assert.equal(sock.calls.length,1);db.close();
});
test('group reports redirect without collecting support details',async()=>{
  const db=groupDb(':memory:'),sock=socket();await groupMessage(sock,db,gc,gm('a','.reporte password=private'),now);assert.equal(sock.calls.length,1);assert.ok(!sock.calls[0][1].text.includes('password'));db.close();
});
test('scheduled group jobs run once and hold ambiguous failures',async()=>{
  const db=groupDb(':memory:'),sock=socket();db.prepare("INSERT INTO jobs(id,jid,kind,text,due) VALUES('a','123@g.us','close','',?)").run(now);await runJobs(sock,db,gc,now);await runJobs(sock,db,gc,now);assert.equal(sock.calls.length,1);assert.equal(db.prepare('SELECT state FROM jobs').get().state,'done');assert.throws(()=>validateGroups({groups:[{jid:'bad'}]}));db.close();
});

test('HTTP: login, CSRF, staff isolation, owner assignment, no privilege escalation',async t=>{
  const db=fixture(),cfg={...config({}),origin:'http://local'},app=createApp(db,cfg);app.listen(0,'127.0.0.1');await new Promise(r=>app.once('listening',r));t.after(()=>new Promise(r=>app.close(()=>{db.close();r();})));
  const base=`http://127.0.0.1:${app.address().port}`;
  db.prepare('INSERT INTO users VALUES(?,?,?,?,1)').run('owner','owner',passwordHash('synthetic-password-1234'),'owner');db.prepare('INSERT INTO users VALUES(?,?,?,?,1)').run('staff','staff',passwordHash('synthetic-password-1234'),'staff');
  inbound(db,message('a','TICKET Error soporte','5215555555555',Date.now()),Date.now());const ticket=db.prepare('SELECT * FROM tickets').get();
  const login=await fetch(base+'/api/login',{method:'POST',headers:{Origin:'http://local','Content-Type':'application/json'},body:JSON.stringify({username:'staff',password:'synthetic-password-1234'})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0],{csrf}=await login.json();
  const call=(path,body,csrfValue=csrf)=>fetch(base+'/api/'+path,{method:body?'POST':'GET',headers:{Cookie:cookie,Origin:'http://local','Content-Type':'application/json','X-CSRF-Token':csrfValue},body:body?JSON.stringify(body):undefined});
  assert.equal((await (await call('dashboard')).json()).tickets.length,0);
  assert.equal((await call('conversation?id='+ticket.customer_id)).status,403);
  assert.equal((await call('work',{type:'tickets',id:ticket.id,status:'resolved'})).status,403);
  db.prepare('UPDATE tickets SET assignee=?').run('staff');assert.equal((await (await call('dashboard')).json()).tickets.length,1);
  const history=await call('conversation?id='+ticket.customer_id);assert.equal(history.status,200);assert.ok((await history.json()).some(m=>m.body==='TICKET Error soporte'));
  assert.equal((await call('work',{type:'tickets',id:ticket.id,status:'resolved'},'bad')).status,403);
  assert.equal((await call('work',{type:'tickets',id:ticket.id,status:'resolved',assignee:'owner'})).status,403);
  assert.equal((await call('work',{type:'tickets',id:ticket.id,status:'resolved'})).status,200);
  assert.equal((await call('product',{id:'x',name:'X',price_cents:1,active:1})).status,403);
  assert.equal((await call('customer',{id:ticket.customer_id,human:1})).status,200);
  assert.equal((await call('reply',{customer_id:ticket.customer_id,text:'Estamos revisando tu caso'})).status,200);
  db.prepare('UPDATE users SET active=0 WHERE id=?').run('staff');assert.equal((await call('dashboard')).status,401);
  const ov=token(),oc=token();db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hash(ov),'owner',oc,Date.now()+60000);
  const assign=await fetch(base+'/api/work',{method:'POST',headers:{Cookie:`cc_session=${ov}`,Origin:'http://local','Content-Type':'application/json','X-CSRF-Token':oc},body:JSON.stringify({type:'tickets',id:ticket.id,status:'processing',assignee:'owner'})});assert.equal(assign.status,200);assert.equal(db.prepare('SELECT assignee FROM tickets').get().assignee,'owner');
});
test('HTTP webhook rejects forgery and processes signed batches idempotently',async t=>{
  const db=fixture(),cfg={...config({}),enabled:true,appSecret:'synthetic-secret',verifyToken:'synthetic-verification-token',phoneId:'123'};
  const app=createApp(db,cfg,async()=> 'synthetic');app.listen(0,'127.0.0.1');await new Promise(r=>app.once('listening',r));t.after(()=>new Promise(r=>app.close(()=>{db.close();r();})));
  const base=`http://127.0.0.1:${app.address().port}/webhooks/whatsapp`;
  const time=Math.floor(Date.now()/1000)*1000;
  const body=JSON.stringify({object:'whatsapp_business_account',entry:[{changes:[{field:'messages',value:{metadata:{phone_number_id:'123'},messages:[message('a','TICKET Error privado','5215555555555',time),message('b','PEDIR test','5215555555555',time)]}}]}]});
  assert.equal((await fetch(base,{method:'POST',body})).status,401);
  const signature='sha256='+createHmac('sha256',cfg.appSecret).update(body).digest('hex');
  for(let i=0;i<2;i++)assert.equal((await fetch(base,{method:'POST',headers:{'X-Hub-Signature-256':signature},body})).status,200);
  assert.equal(db.prepare('SELECT count(*) n FROM tickets').get().n,1);assert.equal(db.prepare('SELECT count(*) n FROM orders').get().n,1);
  const verify=await fetch(base+'?hub.mode=subscribe&hub.verify_token='+cfg.verifyToken+'&hub.challenge=abc');assert.equal(await verify.text(),'abc');
});
