import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
export function groupDb(path) {
  if(path!==':memory:')mkdirSync(dirname(path),{recursive:true,mode:0o700});
  const db=new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS seen(id TEXT PRIMARY KEY,at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,actor TEXT,action TEXT,target TEXT,at INTEGER);
    CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,jid TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('notice','open','close')),text TEXT NOT NULL,due INTEGER NOT NULL,state TEXT NOT NULL DEFAULT 'pending');`);
  return db;
}
export function validateGroups(config) {
  if(!Array.isArray(config.groups)||config.groups.length>50)throw Error('Configuración inválida');
  for(const g of config.groups) {
    if(!/^[0-9-]+@g\.us$/.test(g.jid)||!Array.isArray(g.staffJids)||g.staffJids.some(j=>!/^\d+@(s\.whatsapp\.net|lid)$/.test(j))||typeof g.rules!=='string'||g.rules.length>2000||typeof g.privateContact!=='string'||g.privateContact.length>500)throw Error('Configura JID, reglas, contacto y staff explícitos');
  }
  return config;
}
function log(db,actor,action,target,now){db.prepare('INSERT INTO audit(actor,action,target,at) VALUES(?,?,?,?)').run(actor,action,target,now);}
export async function groupMessage(sock,db,config,msg,now=Date.now()) {
  const jid=msg.key?.remoteJid,g=config.groups.find(g=>g.jid===jid);
  if(!g||msg.key.fromMe||!msg.key.id||!msg.message)return;
  const stamp=Number(msg.messageTimestamp)*1000;
  if(!Number.isFinite(stamp)||Math.abs(now-stamp)>300000)return;
  const sender=msg.key.participant;if(!sender)return;
  const raw=(msg.message.conversation||msg.message.extendedTextMessage?.text||'').trim();
  if(!raw.startsWith('.')||raw.length>2200)return;
  const [command,...args]=raw.split(/\s+/),cmd=command.toLowerCase();
  if(!['.reglas','.menu','.ayuda','.reporte','.codigo','.abrir','.cerrar','.aviso'].includes(cmd))return;
  if(!db.prepare('INSERT OR IGNORE INTO seen VALUES(?,?)').run(`${jid}:${msg.key.id}`,now).changes)return;
  const previous=db.prepare('SELECT at FROM audit WHERE actor=? AND target=? ORDER BY at DESC LIMIT 1').get(sender,jid);
  if(previous&&now-previous.at<10000)return;
  log(db,sender,'command_received',jid,now);
  if(['.reglas','.menu','.ayuda','.reporte','.codigo'].includes(cmd)) {
    await sock.sendMessage(jid,{text:cmd==='.reglas'?g.rules:`${g.privateContact}\nPedidos, renovaciones y tickets se atienden por privado. No publiques claves. Comandos: .reglas; administradores: .abrir .cerrar .aviso texto.`});return;
  }
  if(!g.staffJids.includes(sender))return;
  const metadata=await sock.groupMetadata(jid);
  const admin=j=>metadata.participants.some(p=>p.id===j&&['admin','superadmin'].includes(p.admin));
  // Unresolved LID/PN identity fails closed. Do not guess identity for authorization.
  const bot=sock.user?.id?.replace(/:\d+(?=@)/,'');
  if(!admin(sender)||!admin(bot))return;
  if(cmd==='.aviso') {
    const body=args.join(' ');if(!body||body.length>1800)return;
    await sock.sendMessage(jid,{text:`Aviso Click&Cut\n${body}`});
  }else await sock.groupSettingUpdate(jid,cmd==='.abrir'?'not_announcement':'announcement');
  log(db,sender,cmd.slice(1),jid,now);
}
export async function runJobs(sock,db,config,now=Date.now()) {
  for(const j of db.prepare("SELECT * FROM jobs WHERE state='pending' AND due<=? ORDER BY due LIMIT 5").all(now)) {
    if(!config.groups.some(g=>g.jid===j.jid)){db.prepare("UPDATE jobs SET state='blocked' WHERE id=?").run(j.id);continue;}
    if(!db.prepare("UPDATE jobs SET state='running' WHERE id=? AND state='pending'").run(j.id).changes)continue;
    try {
      const metadata=await sock.groupMetadata(j.jid),bot=sock.user?.id?.replace(/:\d+(?=@)/,'');
      if(!metadata.participants.some(p=>p.id===bot&&['admin','superadmin'].includes(p.admin)))throw Error('Bot requires admin');
      if(j.kind==='notice')await sock.sendMessage(j.jid,{text:j.text});
      else await sock.groupSettingUpdate(j.jid,j.kind==='open'?'not_announcement':'announcement');
      db.prepare("UPDATE jobs SET state='done' WHERE id=?").run(j.id);log(db,'scheduler',j.kind,j.jid,now);
    }catch{db.prepare("UPDATE jobs SET state='unknown' WHERE id=?").run(j.id);}
  }
}
