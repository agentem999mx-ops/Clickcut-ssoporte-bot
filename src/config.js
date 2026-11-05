export function config(env = process.env) {
  const c = {db:env.DB_PATH || 'data/clickcut.sqlite', host:env.HOST || '127.0.0.1', port:Number(env.PORT || 3000),
    origin:env.PUBLIC_ORIGIN || 'http://127.0.0.1:3000', secure:env.NODE_ENV === 'production',
    appSecret:env.META_APP_SECRET || '', verifyToken:env.META_VERIFY_TOKEN || '',
    phoneId:env.META_PHONE_NUMBER_ID || '', token:env.META_ACCESS_TOKEN || '', version:env.META_GRAPH_VERSION || '',
    enabled:env.CLOUD_ENABLED === 'true', templates:(env.META_APPROVED_TEMPLATES || '').split(',').filter(Boolean)};
  if (c.secure && !c.origin.startsWith('https://')) throw new Error('HTTPS origin required');
  if (c.enabled && (!c.appSecret || c.verifyToken.length<24 || !/^\d+$/.test(c.phoneId) || !c.token || !/^v\d+\.\d+$/.test(c.version))) throw new Error('Incomplete Cloud configuration');
  return c;
}
