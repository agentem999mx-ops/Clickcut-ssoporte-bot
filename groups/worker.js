import { readFileSync,mkdirSync } from 'node:fs';
import { groupDb,validateGroups,groupMessage,runJobs } from './core.js';
if(process.env.META_ACCESS_TOKEN||process.env.META_APP_SECRET)throw Error('El worker de grupos no debe recibir secretos de Meta');
if(process.env.GROUPS_ENABLED!=='true'||process.env.GROUPS_RISK_ACCEPTED!=='true')throw Error('Grupos desactivados; revisar riesgos antes de habilitar');
const {default:makeWASocket,useMultiFileAuthState,DisconnectReason}=await import('@whiskeysockets/baileys');
const {default:pino}=await import('pino');
const cfg=validateGroups(JSON.parse(readFileSync(process.env.GROUPS_CONFIG||'groups/config.local.json','utf8')));
const db=groupDb(process.env.GROUPS_DB_PATH||'data/groups.sqlite');
db.prepare("UPDATE jobs SET state='unknown' WHERE state='running'").run();
const dir=process.env.GROUPS_AUTH_DIR||'groups/auth';mkdirSync(dir,{recursive:true,mode:0o700});
const {state,saveCreds}=await useMultiFileAuthState(dir);
let stopping=false,sock,timer,reconnect,attempt=0,chain=Promise.resolve();
function work(fn){chain=chain.then(fn).catch(()=>console.error('group_operation_failed'));}
async function connect(){
  if(stopping)return;
  sock=makeWASocket({auth:state,logger:pino({level:'silent'}),syncFullHistory:false,markOnlineOnConnect:false});
  sock.ev.on('creds.update',()=>work(saveCreds));
  sock.ev.on('messages.upsert',({messages,type})=>{if(type==='notify')for(const msg of messages)work(()=>groupMessage(sock,db,cfg,msg));});
  sock.ev.on('connection.update',({connection,lastDisconnect,qr})=>{
    if(qr&&process.env.GROUPS_PAIRING_LOCAL==='true'&&process.stdout.isTTY)import('qrcode-terminal').then(m=>m.default.generate(qr,{small:true}));
    if(connection==='open'){attempt=0;clearInterval(timer);timer=setInterval(()=>work(()=>runJobs(sock,db,cfg)),5000);}
    if(connection==='close'){
      clearInterval(timer);if(stopping)return;
      if(lastDisconnect?.error?.output?.statusCode===DisconnectReason.loggedOut||++attempt>8){console.error('group_session_requires_operator');process.exitCode=1;stopping=true;return;}
      reconnect=setTimeout(()=>connect().catch(()=>{console.error('group_connect_failed');process.exitCode=1;}),Math.min(60000,1000*2**attempt)+Math.random()*1000);
    }
  });
}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stopping=true;clearInterval(timer);clearTimeout(reconnect);sock?.end(undefined);chain.finally(()=>{db.close();process.exit(0);});setTimeout(()=>process.exit(1),15000).unref();});
await connect();
