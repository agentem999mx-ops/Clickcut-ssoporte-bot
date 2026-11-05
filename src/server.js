import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { openDb, transaction } from './db.js';
import { config } from './config.js';
import { validSignature, passwordValid, token, hash, sessionUser, equal, audit, mayEdit, passwordHash } from './security.js';
import { inbound, enqueue } from './domain.js';
import { createCloud, drain } from './cloud.js';
const fail = (status, message) => Object.assign(new Error(message), {status});
async function rawBody(req, max=262144) {
  let length=0; const chunks=[];
  for await (const chunk of req) { length+=chunk.length; if(length>max) throw fail(413,'Solicitud demasiado grande'); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
function text(value, min=1, max=2000) { if(typeof value!=='string'||value.length<min||value.length>max) throw fail(400,'Texto inválido'); return value; }
export function createApp(db, cfg, sender=createCloud(cfg)) {
  const page=readFileSync(new URL('../public/index.html',import.meta.url));
  const js=readFileSync(new URL('../public/admin.js',import.meta.url));
  const dummy=passwordHash('dummy-unusable-password-for-timing');
  const rates=new Map();
  function rate(key, limit) {
    const now=Date.now(), old=rates.get(key); const v=old&&old.until>now?old:{n:0,until:now+60000};
    if(rates.size>10000) for(const [k,r] of rates) if(r.until<now) rates.delete(k);
    if(rates.size>10000) throw fail(429,'Intenta más tarde');
    rates.set(key,v); if(++v.n>limit) throw fail(429,'Intenta más tarde');
  }
  // A crash after remote acceptance is ambiguous: retain for manual reconciliation.
  db.prepare("UPDATE outbox SET state='unknown' WHERE state='sending'").run();
  const server=createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if(cfg.secure) res.setHeader('Strict-Transport-Security','max-age=31536000');
    function respond(status,body,type='application/json; charset=utf-8') {res.writeHead(status,{'Content-Type':type});res.end(type.startsWith('application/json')?JSON.stringify(body):body);}
    try {
      const url=new URL(req.url,'http://local'); const path=url.pathname;
      if(path==='/health'&&req.method==='GET') {db.prepare('SELECT 1').get();return respond(200,{ok:true});}
      if(path==='/webhooks/whatsapp') {
        if(!cfg.enabled) throw fail(503,'Canal desactivado');
        if(req.method==='GET') {
          if(url.searchParams.get('hub.mode')!=='subscribe'||!equal(url.searchParams.get('hub.verify_token'),cfg.verifyToken)) throw fail(403,'Verificación rechazada');
          return respond(200,url.searchParams.get('hub.challenge')||'','text/plain');
        }
        if(req.method!=='POST') throw fail(405,'Método inválido');
        const raw=await rawBody(req);
        if(!validSignature(raw,req.headers['x-hub-signature-256'],cfg.appSecret)) throw fail(401,'Firma inválida');
        let event;try {event=JSON.parse(raw);}catch{throw fail(400,'JSON inválido');}
        if(event.object!=='whatsapp_business_account') throw fail(400,'Evento inválido');
        // Status updates are atomic. Each inbound message has its own durable transaction;
        // if a later event fails, Meta retries the batch and inbox dedup skips earlier work.
        transaction(db,()=>{
          for(const entry of event.entry||[]) for(const change of entry.changes||[]) {
            const v=change.value;
            if(change.field!=='messages'||v?.metadata?.phone_number_id!==cfg.phoneId) continue;
            for(const status of v.statuses||[]) {
              if(['sent','delivered','read','failed'].includes(status.status)) {
                const ranks={sent:1,delivered:2,read:3,failed:0};
                const previous=db.prepare('SELECT delivery FROM outbox WHERE provider_id=?').get(status.id);
                if(previous && (!previous.delivery || ranks[status.status]>ranks[previous.delivery])) db.prepare('UPDATE outbox SET delivery=? WHERE provider_id=?').run(status.status,status.id);
              }
            }
          }
        });
        for(const entry of event.entry||[]) for(const change of entry.changes||[]) {
          const v=change.value;
          if(change.field==='messages'&&v?.metadata?.phone_number_id===cfg.phoneId) for(const message of v.messages||[]) inbound(db,message);
        }
        return respond(200,{received:true});
      }
      if((path==='/'||path==='/admin.js')&&req.method==='GET') return respond(200,path==='/'?page:js,path==='/'?'text/html; charset=utf-8':'text/javascript; charset=utf-8');
      if(!path.startsWith('/api/')) throw fail(404,'No encontrado');
      rate(req.socket.remoteAddress,120);
      let body={};
      if(req.method==='POST') {
        if(req.headers.origin!==cfg.origin) throw fail(403,'Origen inválido');
        if(!req.headers['content-type']?.startsWith('application/json')) throw fail(415,'Se requiere JSON');
        try {body=JSON.parse(await rawBody(req,16384));}catch(e){if(e.status) throw e;throw fail(400,'JSON inválido');}
        if(!body||Array.isArray(body)||typeof body!=='object') throw fail(400,'Objeto inválido');
      }
      if(path==='/api/login'&&req.method==='POST') {
        rate(`login:${req.socket.remoteAddress}`,5);
        const u=typeof body.username==='string'?db.prepare('SELECT * FROM users WHERE username=? AND active=1').get(body.username):null;
        const valid=passwordValid(body.password,u?.password||dummy);
        if(!u||!valid) throw fail(401,'Acceso inválido');
        const value=token(),csrf=token();
        transaction(db,()=>{
          db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
          db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hash(value),u.id,csrf,Date.now()+28800000);
          audit(db,u.id,'login',u.id);
        });
        res.setHeader('Set-Cookie',`cc_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${cfg.secure?'; Secure':''}`);
        return respond(200,{csrf,role:u.role});
      }
      const user=sessionUser(db,req.headers.cookie);
      if(!user) throw fail(401,'Inicia sesión');
      if(req.method==='POST'&&!equal(req.headers['x-csrf-token'],user.csrf)) throw fail(403,'Sesión inválida');
      if(path==='/api/me'&&req.method==='GET') return respond(200,user);
      if(path==='/api/conversation'&&req.method==='GET') {
        const id=text(url.searchParams.get('id'),1,64);
        const allowed=user.role==='owner'||db.prepare('SELECT 1 FROM tickets WHERE customer_id=? AND assignee=? UNION ALL SELECT 1 FROM orders WHERE customer_id=? AND assignee=?').get(id,user.id,id,user.id);
        if(!allowed)throw fail(403,'Sin permiso');
        const incoming=db.prepare("SELECT id,body,sent_at AS at,'inbound' AS direction FROM messages WHERE customer_id=? ORDER BY received_at DESC LIMIT 50").all(id);
        const outgoing=db.prepare('SELECT id,payload,state,created_at AS at FROM outbox WHERE customer_id=? ORDER BY created_at DESC LIMIT 50').all(id).map(r=>({id:r.id,body:JSON.parse(r.payload).text||'[Plantilla '+JSON.parse(r.payload).name+']',state:r.state,at:r.at,direction:'outbound'}));
        audit(db,user.id,'conversation_view',id);
        return respond(200,[...incoming,...outgoing].sort((a,b)=>a.at-b.at));
      }
      if(path==='/api/logout'&&req.method==='POST') {
        db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
        res.setHeader('Set-Cookie','cc_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return respond(200,{ok:true});
      }
      if(path==='/api/dashboard'&&req.method==='GET') {
        const mine=user.role==='owner'?'':' WHERE assignee=?';const args=user.role==='owner'?[]:[user.id];
        const rows=table=>db.prepare(`SELECT * FROM ${table}${mine} ORDER BY created_at DESC LIMIT 100`).all(...args);
        const customers=user.role==='owner'?db.prepare('SELECT id,human,opted_out,last_inbound FROM customers LIMIT 100').all():db.prepare('SELECT DISTINCT c.id,c.human,c.opted_out,c.last_inbound FROM customers c WHERE EXISTS(SELECT 1 FROM tickets t WHERE t.customer_id=c.id AND t.assignee=?) OR EXISTS(SELECT 1 FROM orders o WHERE o.customer_id=c.id AND o.assignee=?) LIMIT 100').all(user.id,user.id);
        return respond(200,{orders:rows('orders'),tickets:rows('tickets'),customers,products:db.prepare('SELECT * FROM products').all(),users:user.role==='owner'?db.prepare('SELECT id,username,role,active FROM users').all():[],outbox:user.role==='owner'?db.prepare('SELECT id,state,delivery,attempts FROM outbox ORDER BY created_at DESC LIMIT 100').all():[]});
      }
      if(req.method!=='POST') throw fail(404,'No encontrado');
      const result=transaction(db,()=>{
        if(path==='/api/product') {
          if(user.role!=='owner') throw fail(403,'Solo owner');
          const id=text(body.id,1,64),name=text(body.name,1,120);
          if(!/^[a-z0-9-]+$/.test(id)||!Number.isSafeInteger(body.price_cents)||body.price_cents<0||body.price_cents>100000000||![0,1].includes(body.active)) throw fail(400,'Producto inválido');
          db.prepare('INSERT INTO products(id,name,price_cents,active) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,price_cents=excluded.price_cents,active=excluded.active').run(id,name,body.price_cents,body.active);
          audit(db,user.id,'product_update',id);return {ok:true};
        }
        if(path==='/api/work') {
          if(!['tickets','orders'].includes(body.type)) throw fail(400,'Tipo inválido');
          const row=db.prepare(`SELECT * FROM ${body.type} WHERE id=?`).get(text(body.id,1,64));
          if(!row) throw fail(404,'Folio no encontrado');
          if(!mayEdit(user,row)) throw fail(403,'Sin permiso');
          const states=body.type==='tickets'?['pending','processing','resolved']:['pending','processing','completed','cancelled'];
          if(!states.includes(body.status)) throw fail(400,'Estado inválido');
          let assignee=row.assignee;
          if(Object.hasOwn(body,'assignee')) {
            if(user.role!=='owner') throw fail(403,'Solo owner puede asignar');
            assignee=body.assignee||null;
            if(assignee&&!db.prepare('SELECT id FROM users WHERE id=? AND active=1').get(assignee)) throw fail(400,'Responsable inválido');
          }
          db.prepare(`UPDATE ${body.type} SET status=?,assignee=? WHERE id=?`).run(body.status,assignee,row.id);
          audit(db,user.id,`${body.type}:${body.status}`,row.id);return {ok:true};
        }
        if(path==='/api/customer') {
          const c=db.prepare('SELECT * FROM customers WHERE id=?').get(text(body.id,1,64));
          if(!c) throw fail(404,'Cliente no encontrado');
          const allowed=user.role==='owner'||db.prepare('SELECT 1 FROM tickets WHERE customer_id=? AND assignee=? UNION ALL SELECT 1 FROM orders WHERE customer_id=? AND assignee=?').get(c.id,user.id,c.id,user.id);
          if(!allowed) throw fail(403,'Sin permiso');
          if(![0,1].includes(body.human)) throw fail(400,'Modo inválido');
          if(body.human) db.prepare("UPDATE outbox SET state='blocked' WHERE customer_id=? AND state='pending'").run(c.id);
          db.prepare('UPDATE customers SET human=? WHERE id=?').run(body.human,c.id);
          audit(db,user.id,'human_mode:'+body.human,c.id);return {ok:true};
        }
        if(path==='/api/reply') {
          const c=db.prepare('SELECT * FROM customers WHERE id=?').get(text(body.customer_id,1,64));
          if(!c) throw fail(404,'Cliente no encontrado');
          const allowed=user.role==='owner'||db.prepare('SELECT 1 FROM tickets WHERE customer_id=? AND assignee=? UNION ALL SELECT 1 FROM orders WHERE customer_id=? AND assignee=?').get(c.id,user.id,c.id,user.id);
          if(!allowed||!c.human) throw fail(403,'Requiere atención humana asignada');
          if(c.opted_out) throw fail(409,'Cliente dado de baja');
          let payload;
          if(body.template) {
            const name=text(body.template,1,120),language=text(body.language,2,10);
            if(!cfg.templates.includes(`${name}:${language}`)) throw fail(400,'Plantilla no autorizada');
            payload={type:'template',name,language};
          } else {
            if(Date.now()-c.last_inbound>=86400000) throw fail(409,'Ventana cerrada; usa plantilla aprobada');
            payload={type:'text',text:text(body.text,1,2000)};
          }
          const id=enqueue(db,c.id,payload);audit(db,user.id,'reply_queued',id);return {id};
        }
        throw fail(404,'No encontrado');
      });
      respond(200,result);
    }catch(e){respond(e.status||500,{error:e.status?e.message:'Error interno'});}
  });
  server.requestTimeout=20000;server.headersTimeout=10000;
  let busy=false;
  const timer=cfg.enabled?setInterval(async()=>{if(busy)return;busy=true;try{await drain(db,sender);}catch{console.error('outbox_tick_failed');}finally{busy=false;}},2000):null;
  server.on('close',()=>clearInterval(timer));
  return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const cfg=config(),db=openDb(cfg.db),app=createApp(db,cfg);
  app.listen(cfg.port,cfg.host,()=>console.log('Click&Cut listo; Cloud '+(cfg.enabled?'habilitado':'desactivado')));
  for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{app.close(()=>{db.close();process.exit(0);});setTimeout(()=>process.exit(1),20000).unref();});
}
