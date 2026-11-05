let csrf='',role='';
const el=id=>document.getElementById(id);
async function api(path,body) {
  const r=await fetch('/api/'+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json','X-CSRF-Token':csrf}:{},body:body?JSON.stringify(body):undefined});
  const j=await r.json();if(!r.ok)throw Error(j.error);return j;
}
function report(e){el('message').textContent=e.message;}
function button(label,fn){const b=document.createElement('button');b.textContent=label;b.onclick=()=>Promise.resolve().then(fn).catch(report);return b;}
async function refresh(){
  const d=await api('dashboard');el('panel').hidden=false;el('login').hidden=true;el('product').hidden=role!=='owner';el('work').replaceChildren();el('customers').replaceChildren();
  for(const type of ['tickets','orders'])for(const row of d[type]) {
    const item=document.createElement('section'),p=document.createElement('p');p.textContent=JSON.stringify(row);item.append(p);
    const s=document.createElement('select');for(const v of type==='tickets'?['pending','processing','resolved']:['pending','processing','completed','cancelled']){const o=document.createElement('option');o.value=v;o.textContent=v;o.selected=v===row.status;s.append(o);}item.append(s);
    let a;if(role==='owner'){a=document.createElement('select');const blank=document.createElement('option');blank.value='';blank.textContent='Sin asignar';a.append(blank);for(const u of d.users.filter(u=>u.active)){const o=document.createElement('option');o.value=u.id;o.textContent=u.username;o.selected=u.id===row.assignee;a.append(o);}item.append(a);}
    item.append(button('Guardar',async()=>{await api('work',{type,id:row.id,status:s.value,...(a?{assignee:a.value}:{})});await refresh();}));el('work').append(item);
  }
  for(const c of d.customers){const p=document.createElement('p');p.textContent=`${c.id} · Humano: ${c.human} · Baja: ${c.opted_out}`;p.append(button('Ver conversación',async()=>{el('conversation').textContent=JSON.stringify(await api('conversation?id='+encodeURIComponent(c.id)),null,2);el('reply').elements.customer_id.value=c.id;}));p.append(button(c.human?'Reanudar bot':'Atender manualmente',async()=>{await api('customer',{id:c.id,human:c.human?0:1});await refresh();}));el('customers').append(p);}
  for(const k of ['products','users','outbox'])el(k).textContent=JSON.stringify(d[k],null,2);
}
el('login').onsubmit=async e=>{e.preventDefault();try{const f=new FormData(e.target);const r=await api('login',Object.fromEntries(f));csrf=r.csrf;role=r.role;e.target.reset();await refresh();}catch(e){report(e);}};
el('refresh').onclick=()=>refresh().catch(report);
el('logout').onclick=async()=>{try{await api('logout',{});location.reload();}catch(e){report(e);}};
el('product').onsubmit=async e=>{e.preventDefault();try{const f=new FormData(e.target);await api('product',{id:f.get('id'),name:f.get('name'),price_cents:Number(f.get('price_cents')),active:f.has('active')?1:0});await refresh();}catch(e){report(e);}};
el('reply').onsubmit=async e=>{e.preventDefault();try{await api('reply',Object.fromEntries(new FormData(e.target)));el('message').textContent='Respuesta en cola';await refresh();}catch(e){report(e);}};
api('me').then(async u=>{csrf=u.csrf;role=u.role;await refresh();}).catch(()=>{});
