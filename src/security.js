import { randomBytes, scryptSync, timingSafeEqual, createHash, createHmac } from 'node:crypto';
export const token = () => randomBytes(32).toString('hex');
export const hash = value => createHash('sha256').update(value).digest('hex');
export function equal(a, b) {
  const x = Buffer.from(a || ''), y = Buffer.from(b || '');
  return x.length === y.length && timingSafeEqual(x, y);
}
export function passwordHash(password) {
  if (typeof password !== 'string' || password.length < 14 || password.length > 256) throw new Error('Password must be 14-256 characters');
  const salt = token(); return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
export function passwordValid(password, stored) {
  if (typeof password !== 'string' || password.length > 256) return false;
  const [salt, digest] = stored.split(':');
  return equal(scryptSync(password, salt, 64).toString('hex'), digest);
}
export function validSignature(raw, signature, secret) {
  return !!secret && equal(signature, `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`);
}
export function audit(db, actor, action, target, now = Date.now()) {
  db.prepare('INSERT INTO audit(actor,action,target,created_at) VALUES(?,?,?,?)').run(actor, action, target, now);
}
export function sessionUser(db, cookie = '', now = Date.now()) {
  const value = cookie.split(';').map(x => x.trim()).find(x => x.startsWith('cc_session='))?.slice(11);
  if (!value || !/^[a-f0-9]{64}$/.test(value)) return null;
  return db.prepare('SELECT u.id,u.username,u.role,s.csrf FROM sessions s JOIN users u ON s.user_id=u.id WHERE s.hash=? AND s.expires>? AND u.active=1').get(hash(value), now);
}
export function mayEdit(user, row) { return user.role === 'owner' || row.assignee === user.id; }
