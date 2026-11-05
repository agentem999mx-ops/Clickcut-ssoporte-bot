// Disabled future port: no assumptions about accesos-control's current API.
export class AccessControlPort {
  async availability(_productId) { throw new Error('Integración accesos-control no habilitada'); }
  async assignmentStatus(_externalRef) { throw new Error('Integración accesos-control no habilitada'); }
}
export function minimalAvailability(raw) {
  if(typeof raw?.product_id!=='string'||raw.product_id.length>64||typeof raw.available!=='boolean')throw Error('Respuesta inválida');
  return {product_id:raw.product_id,available:raw.available};
}
export function minimalAssignment(raw) {
  if(typeof raw?.external_ref!=='string'||raw.external_ref.length>64||!['pending','active','expired','revoked'].includes(raw.status))throw Error('Respuesta inválida');
  const expires_at=raw.expires_at;
  if(expires_at!==null&&(typeof expires_at!=='string'||!Number.isFinite(Date.parse(expires_at))))throw Error('Vencimiento inválido');
  return {external_ref:raw.external_ref,status:raw.status,expires_at};
}
