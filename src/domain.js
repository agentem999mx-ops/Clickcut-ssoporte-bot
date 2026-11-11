import { randomUUID } from 'node:crypto';
import { transaction } from './db.js';
import { audit } from './security.js';
export const menu = 'Click&Cut: CATALOGO | PEDIR producto-id | RENOVAR pedido-id | TICKET detalle | ESTADO folio | HUMANO | BAJA | ALTA. No envíes contraseñas ni códigos.';
export function enqueue(db, customerId, payload, now = Date.now()) {
  const id = randomUUID();
  db.prepare('INSERT INTO outbox(id,customer_id,payload,next_at,created_at) VALUES(?,?,?,?,?)').run(id, customerId, JSON.stringify(payload), now, now);
  return id;
}
export function inbound(db, message, now = Date.now()) {
  const {id, from, timestamp} = message;
  if (typeof id !== 'string' || !/^\d{5,20}$/.test(from || '') || !/^\d+$/.test(String(timestamp))) return false;
  const sent = Number(timestamp) * 1000;
  if (!Number.isSafeInteger(sent) || sent > now + 300000) return false;
  // Preserve Meta's original timestamp: retries must never reopen an expired window.
  return transaction(db, () => {
    if (db.prepare('SELECT 1 FROM inbox WHERE id=?').get(id)) return false;
    db.prepare('INSERT INTO inbox VALUES(?,?)').run(id, now);
    db.prepare('INSERT INTO customers(id,wa_id,last_inbound) VALUES(?,?,?) ON CONFLICT(wa_id) DO UPDATE SET last_inbound=MAX(last_inbound,excluded.last_inbound)').run(randomUUID(), from, sent);
    const c = db.prepare('SELECT * FROM customers WHERE wa_id=?').get(from);
    let text = (message.text?.body || message.interactive?.button_reply?.id || message.interactive?.list_reply?.id || '').trim().slice(0, 2000);
    db.prepare('INSERT INTO messages(id,customer_id,body,sent_at,received_at) VALUES(?,?,?,?,?)').run(id,c.id,text||'[Mensaje sin texto; solicitar descripción por escrito]',sent,now);
    const [cmd, ...parts] = text.split(/\s+/); const arg = parts.join(' ');
    const command = cmd.toUpperCase(); let reply = menu;
    if (command === 'BAJA') {
      db.prepare('UPDATE customers SET opted_out=1 WHERE id=?').run(c.id);
      db.prepare("UPDATE outbox SET state='blocked' WHERE customer_id=? AND state='pending'").run(c.id);
      audit(db, c.id, 'opt_out', c.id, now); return true;
    }
    if (command === 'ALTA') db.prepare('UPDATE customers SET opted_out=0 WHERE id=?').run(c.id);
    else if (c.opted_out) return true;
    if (command === 'HUMANO') {
      db.prepare("UPDATE outbox SET state='blocked' WHERE customer_id=? AND state='pending'").run(c.id);
      db.prepare('UPDATE customers SET human=1 WHERE id=?').run(c.id);
      const folio = randomUUID();
      db.prepare('INSERT INTO tickets(id,customer_id,detail,created_at) VALUES(?,?,?,?)').run(folio,c.id,'Solicitud de atención humana',now);
      reply = `Atención humana solicitada. Folio ${folio}.`;
    } else if (c.human && command !== 'ALTA') return true;
    else if (command === 'CATALOGO') {
      const items = db.prepare('SELECT * FROM products WHERE active=1 ORDER BY name LIMIT 30').all();
      reply = items.length ? items.map(p => `${p.id}: ${p.name} — ${(p.price_cents / 100).toFixed(2)} ${p.currency}`).join('\n') : 'Catálogo pendiente de configuración. Escribe HUMANO.';
    } else if (command === 'PEDIR') {
      const p = db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(arg);
      if (!p) reply = 'Producto no disponible. Escribe CATALOGO.';
      else {
        const folio = randomUUID();
        db.prepare("INSERT INTO orders(id,customer_id,product_id,price_cents,kind,created_at) VALUES(?,?,?,?,'purchase',?)").run(folio,c.id,p.id,p.price_cents,now);
        reply = `Solicitud ${folio} registrada por ${(p.price_cents/100).toFixed(2)} ${p.currency}. Pendiente de confirmar disponibilidad y pago con el equipo.`;
      }
    } else if (command === 'RENOVAR') {
      const old = db.prepare("SELECT o.*,p.active,p.price_cents AS current_price FROM orders o JOIN products p ON p.id=o.product_id WHERE o.id=? AND o.customer_id=? AND o.status='completed'").get(arg,c.id);
      if (!old || !old.active) reply = 'No se encontró un pedido renovable de tu cuenta. Escribe HUMANO.';
      else {
        const folio = randomUUID();
        db.prepare("INSERT INTO orders(id,customer_id,product_id,price_cents,kind,reference,created_at) VALUES(?,?,?,?,'renewal',?,?)").run(folio,c.id,old.product_id,old.current_price,old.id,now);
        reply = `Renovación ${folio} solicitada. Pendiente de revisión; no se ha cobrado ni extendido el servicio.`;
      }
    } else if (command === 'TICKET') {
      if (arg.length < 8) reply = 'Escribe TICKET seguido del servicio y el problema (mínimo 8 caracteres). No incluyas claves.';
      else {
        const folio = randomUUID();
        db.prepare('INSERT INTO tickets(id,customer_id,detail,created_at) VALUES(?,?,?,?)').run(folio,c.id,arg,now);
        reply = `Ticket ${folio} registrado. Estado: pendiente.`;
      }
    } else if (command === 'ESTADO') {
      const row = db.prepare('SELECT status FROM tickets WHERE id=? AND customer_id=? UNION ALL SELECT status FROM orders WHERE id=? AND customer_id=?').get(arg,c.id,arg,c.id);
      reply = row ? `Estado: ${row.status}` : 'Folio no disponible en tu cuenta.';
    }
    enqueue(db, c.id, {type:'text', text:reply}, now);
    audit(db,c.id,'inbound_processed',id,now); return true;
  });
}
