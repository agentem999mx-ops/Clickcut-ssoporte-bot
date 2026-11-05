// No archived SDK dependency: use versioned Graph HTTP API directly.
export function createCloud(config, fetcher = fetch) {
  return async (waId, payload) => {
    if (!config.enabled) throw new Error('Cloud disabled');
    const body = {messaging_product:'whatsapp', to:waId,
      ...(payload.type === 'template' ? {type:'template', template:{name:payload.name,language:{code:payload.language}}} : {type:'text',text:{body:payload.text}})};
    const response = await fetcher(`https://graph.facebook.com/${config.version}/${config.phoneId}/messages`, {
      method:'POST', headers:{Authorization:`Bearer ${config.token}`,'Content-Type':'application/json'},
      body:JSON.stringify(body), signal:AbortSignal.timeout(15000)
    });
    // Never persist raw provider errors: they may include personal data or tokens.
    if (!response.ok) { const e = new Error('Provider rejected message'); e.status=response.status; throw e; }
    const json = await response.json();
    if (!json.messages?.[0]?.id) throw new Error('Ambiguous provider response');
    return json.messages[0].id;
  };
}
export async function drain(db, send, now = Date.now()) {
  const rows = db.prepare("SELECT o.*,c.wa_id,c.last_inbound,c.opted_out FROM outbox o JOIN customers c ON c.id=o.customer_id WHERE o.state='pending' AND o.next_at<=? ORDER BY o.created_at LIMIT 20").all(now);
  for (const row of rows) {
    const payload = JSON.parse(row.payload);
    if (row.opted_out || (payload.type !== 'template' && now-row.last_inbound>=86400000)) {
      db.prepare("UPDATE outbox SET state='blocked' WHERE id=?").run(row.id); continue;
    }
    // Claim synchronously before I/O; only one official service instance is supported.
    if (!db.prepare("UPDATE outbox SET state='sending',attempts=attempts+1 WHERE id=? AND state='pending'").run(row.id).changes) continue;
    try {
      const providerId = await send(row.wa_id,payload);
      db.prepare("UPDATE outbox SET state='sent',provider_id=? WHERE id=?").run(providerId,row.id);
    } catch (e) {
      // A timeout/5xx may have delivered. Do not blindly retry and duplicate messages.
      const retry = e.status === 429 && row.attempts < 4;
      const state = retry ? 'pending' : (e.status && e.status < 500 ? 'failed' : 'unknown');
      db.prepare('UPDATE outbox SET state=?,next_at=? WHERE id=?').run(state, now+Math.min(3600000,60000*2**row.attempts),row.id);
    }
  }
}
