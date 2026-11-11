import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { groupDb,validateGroups } from './core.js';
const [jid,kind,iso,...words]=process.argv.slice(2),body=words.join(' '),due=Date.parse(iso);
const cfg=validateGroups(JSON.parse(readFileSync(process.env.GROUPS_CONFIG||'groups/config.local.json','utf8')));
if(!cfg.groups.some(g=>g.jid===jid)||!['notice','open','close'].includes(kind)||!iso?.endsWith('Z')||!Number.isFinite(due)||due<=Date.now()||(kind==='notice'&&(!body||body.length>1800)))throw Error('Uso: node --env-file=.env groups/schedule.js JID notice|open|close FECHA-UTC texto');
const db=groupDb(process.env.GROUPS_DB_PATH||'data/groups.sqlite');
try{const id=randomUUID();db.prepare('INSERT INTO jobs(id,jid,kind,text,due) VALUES(?,?,?,?,?)').run(id,jid,kind,body,due);console.log(id);}finally{db.close();}
