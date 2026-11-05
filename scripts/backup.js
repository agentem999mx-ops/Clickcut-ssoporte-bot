import { DatabaseSync,backup } from 'node:sqlite';
import { mkdirSync,existsSync } from 'node:fs';
import { dirname,resolve } from 'node:path';
const [source,destination]=process.argv.slice(2);
if(!source||!destination||!existsSync(source)||resolve(source)===resolve(destination)||existsSync(destination))throw Error('Uso: node scripts/backup.js origen.sqlite destino-nuevo.sqlite');
mkdirSync(dirname(destination),{recursive:true,mode:0o700});
const db=new DatabaseSync(source,{readOnly:true});
try{await backup(db,destination);console.log('Backup consistente creado; aplicar cifrado y retención.');}finally{db.close();}
