import { openDb, transaction } from './db.js';
import { passwordHash, audit } from './security.js';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
const [action,username,role]=process.argv.slice(2);
if(!['create','disable','password'].includes(action)||!username||! /^[a-zA-Z0-9._-]{3,60}$/.test(username)) throw new Error('Uso: npm run user -- create usuario owner|staff (contraseña por stdin); disable usuario; password usuario (stdin)');
const db=openDb(process.env.DB_PATH);
try {transaction(db,()=>{
  if(action==='create') {
    if(!['owner','staff'].includes(role)) throw new Error('Rol inválido');
    const password=readFileSync(0,'utf8').replace(/\r?\n$/,'');
    db.prepare('INSERT INTO users VALUES(?,?,?,?,1)').run(randomUUID(),username,passwordHash(password),role);
  }else{
    const u=db.prepare('SELECT * FROM users WHERE username=?').get(username);if(!u)throw new Error('Usuario no encontrado');
    if(action==='disable') {
      if(u.role==='owner'&&db.prepare("SELECT count(*) AS n FROM users WHERE role='owner' AND active=1").get().n<=1)throw new Error('No desactivar el último owner');
      db.prepare('UPDATE users SET active=0 WHERE id=?').run(u.id);
    }else db.prepare('UPDATE users SET password=? WHERE id=?').run(passwordHash(readFileSync(0,'utf8').replace(/\r?\n$/,'')),u.id);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);
  }
  audit(db,'local_operator',action,username);
});console.log('Usuario actualizado');}finally{db.close();}
