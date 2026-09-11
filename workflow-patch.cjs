const http = require('http');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3');

const originalEmit = http.Server.prototype.emit;
function dbOpen(){ return new sqlite3.Database(process.env.DATABASE_PATH || './driverpool24.db'); }
function auth(req,res,role){
  const h=req.headers.authorization||''; const token=h.startsWith('Bearer ')?h.slice(7):null;
  if(!token){res.statusCode=401;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:'Anmeldung erforderlich'}));return null;}
  try{ const secret=process.env.JWT_SECRET || (process.env.NODE_ENV==='production'?null:'dev-secret'); if(!secret) throw Error(); const u=jwt.verify(token,secret); if(role&&u.role!==role){res.statusCode=403;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:'Keine Berechtigung'}));return null;} return u; }catch(e){res.statusCode=401;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:'Sitzung abgelaufen. Bitte erneut anmelden.'}));return null;}
}
function json(res,status,data){res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(data));}
function readBody(req,done){let body='';req.on('data',c=>body+=c);req.on('end',()=>{try{done(JSON.parse(body||'{}'));}catch{done({});}});}
function driverUi(){
  const token=localStorage.getItem('driverpool24_token'); const raw=localStorage.getItem('driverpool24_user');
  if(!token||!raw)return; let user; try{user=JSON.parse(raw)}catch{return}
  if(user.role!=='fahrer')return; const H={'Authorization':'Bearer '+token,'Content-Type':'application/json'};
  const api=(u,o={})=>fetch(u,{...o,headers:{...H,...(o.headers||{})}});
  async function refresh(){ const r=await api('/api/jobs'); if(!r.ok)return; const jobs=await r.json(); jobs.filter(j=>Number(j.fahrer_id)===Number(user.id)).forEach(j=>{
    const nodes=[...document.querySelectorAll('div')].filter(x=>(x.textContent||'').includes(j.titel)); const card=nodes.find(x=>x.children.length<15); if(!card||card.querySelector('[data-wf="'+j.id+'"]'))return;
    const box=document.createElement('div'); box.dataset.wf=j.id; box.style.marginTop='10px'; const status=document.createElement('strong'); status.textContent='Status: '+j.status; box.appendChild(status); box.appendChild(document.createTextNode(' '));
    if(j.status==='reserviert') box.appendChild(btn('▶️ Auftrag starten','/api/jobs/'+j.id+'/start')); if(j.status==='gestartet') box.appendChild(btn('✅ Auftrag abschließen','/api/jobs/'+j.id+'/complete')); card.appendChild(box); }); }
  function btn(label,url){const b=document.createElement('button'); b.textContent=label; b.style.marginLeft='8px'; b.onclick=async()=>{const r=await api(url,{method:'POST'}); const d=await r.json(); alert(d.error||'Erfolgreich.'); if(r.ok)location.reload()}; return b;}
  setTimeout(refresh,800); setInterval(refresh,5000);
}
function adminBillingUi(){
  const token=localStorage.getItem('driverpool24_admin_token'); const raw=localStorage.getItem('driverpool24_admin_user');
  if(!token||!raw)return; let user; try{user=JSON.parse(raw)}catch{return}
  if(user.role!=='admin')return;
  const H={'Authorization':'Bearer '+token,'Content-Type':'application/json'};
  const api=(u,o={})=>fetch(u,{...o,headers:{...H,...(o.headers||{})}});
  const money=v=>Number(v||0).toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2})+' €';
  const esc=s=>String(s??'').replace(/[&<>\"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
  async function loadBilling(){
    const box=document.getElementById('billingArea'); if(!box)return;
    box.innerHTML='<p class="muted">Zahlungsdaten werden geladen …</p>';
    try{const r=await api('/api/admin/billing');const d=await r.json();if(!r.ok)throw Error(d.error||'Zahlungsdaten konnten nicht geladen werden.');
      const s=d.summary||{};
      let html='<div class="grid wide">'+
        '<div class="card"><div class="muted">Offene Zahlungen</div><div class="num">'+s.ausstehend_count+'</div><div>'+money(s.ausstehend_sum)+'</div></div>'+
        '<div class="card"><div class="muted">Bezahlt</div><div class="num">'+s.bezahlt_count+'</div><div>'+money(s.bezahlt_sum)+'</div></div>'+
        '<div class="card"><div class="muted">Auszahlung freigegeben</div><div class="num">'+s.freigegeben_count+'</div><div>'+money(s.freigegeben_sum)+'</div></div>'+
        '<div class="card"><div class="muted">Ausgezahlt</div><div class="num">'+s.ausgezahlt_count+'</div><div>'+money(s.ausgezahlt_sum)+'</div></div>'+
        '</div>';
      html+='<div class="card wide"><h2>💰 Zahlungsabwicklung</h2><p class="muted">Auftrag → Rechnung → Zahlung → Fahrer-Auszahlung</p>';
      if(!d.invoices.length)html+='<p class="muted">Noch keine Rechnungen vorhanden. Bei reservierten Aufträgen kann der Admin eine Rechnung erstellen.</p>';
      d.invoices.forEach(i=>{
        const status=i.zahlungsstatus==='ausstehend'?'🟡 Zahlung ausstehend':i.auszahlungsstatus==='gesichert'?'🟢 Bezahlt · Fahrerzahlung gesichert':i.auszahlungsstatus==='auszahlung_freigegeben'?'✅ Auszahlung freigegeben':'💶 Ausgezahlt';
        html+='<div class="row" style="display:block"><div style="display:flex;justify-content:space-between;gap:15px;flex-wrap:wrap"><div><b>Rechnung #'+i.id+'</b> · Auftrag #'+i.job_id+' · '+esc(i.titel||'')+'</div><b>'+status+'</b></div>'+
          '<div class="muted" style="margin-top:7px">Firma: '+esc(i.firma_name||'–')+' · Fahrer: '+esc(i.fahrer_name||'–')+'</div>'+
          '<div style="margin-top:7px">Fahrerlohn: <b>'+money(i.fahrerlohn)+'</b> · Gebühr: <b>'+money(i.gebuehr)+'</b> · Gesamt: <b>'+money(i.gesamt)+'</b></div>'+
          '<div style="margin-top:10px">'+
          (i.zahlungsstatus==='ausstehend'?'<button class="primary" onclick="billingAction('+i.id+',\'pay\')">🟢 Zahlung als bezahlt markieren</button> ':'')+
          (i.zahlungsstatus==='bezahlt'&&i.auszahlungsstatus==='gesichert'?'<button class="primary" onclick="billingAction('+i.id+',\'release\')">✅ Fahrerzahlung freigeben</button> ':'')+
          (i.auszahlungsstatus==='auszahlung_freigegeben'?'<button class="primary" onclick="billingAction('+i.id+',\'payout\')">💶 Auszahlung als ausgezahlt markieren</button>':'')+
          '</div></div>';
      });
      html+='</div><div class="card wide"><h2>🧾 Rechnungen für reservierte Aufträge</h2>';
      const without=d.jobs.filter(j=>!j.invoice_id&&j.fahrer_id);
      if(!without.length)html+='<p class="muted">Keine reservierten Aufträge ohne Rechnung.</p>';
      without.forEach(j=>{html+='<div class="row"><span><b>Auftrag #'+j.id+'</b> · '+esc(j.titel||'')+'<br><span class="muted">Firma: '+esc(j.firma_name||'–')+' · Fahrer: '+esc(j.fahrer_name||'–')+' · vorgeschlagener Fahrerlohn: '+money(j.preis)+'</span></span><button class="primary" onclick="createBillingInvoice('+j.id+')">🧾 Rechnung erstellen</button></div>';});
      html+='</div>';
      box.innerHTML=html;
    }catch(e){box.innerHTML='<p class="error">'+esc(e.message)+'</p>';}
  }
  window.billingAction=async(id,action)=>{if(!confirm('Diesen Zahlungsschritt wirklich durchführen?'))return;const r=await api('/api/admin/invoices/'+id+'/'+action,{method:'POST'});const d=await r.json();alert(d.error||d.message||'Erfolgreich.');if(r.ok)loadBilling();};
  window.createBillingInvoice=async(jobId)=>{const fahrerlohn=prompt('Fahrerlohn in €:', '');if(fahrerlohn===null)return;const gebuehr=prompt('DriverPool24-Gebühr in €:', '');if(gebuehr===null)return;const r=await api('/api/admin/invoices',{method:'POST',body:JSON.stringify({job_id:jobId,fahrerlohn:Number(fahrerlohn),gebuehr:Number(gebuehr)})});const d=await r.json();alert(d.error||d.message||'Rechnung erstellt.');if(r.ok)loadBilling();};
  const host=document.querySelector('main'); if(host&&!document.getElementById('billingArea')){const section=document.createElement('section');section.id='billingArea';section.style.margin='20px 0';host.appendChild(section);}
  setTimeout(loadBilling,100); window.loadBilling=loadBilling;
}
function handle(req,res){
  const u=new URL(req.url,'http://localhost'); const p=u.pathname;
  if(req.method==='GET' && p==='/driver.html'){
    const file=path.join(process.cwd(),'driver.html');
    try{ let html=fs.readFileSync(file,'utf8'); html=html.replace('</body>',`<script>(${driverUi.toString()})();</script></body>`); res.statusCode=200; res.setHeader('Content-Type','text/html; charset=utf-8'); res.end(html); }catch(e){ return false; }
    return true;
  }
  if(req.method==='GET' && p==='/admin.html'){
    const file=path.join(process.cwd(),'admin.html');
    try{ let html=fs.readFileSync(file,'utf8'); html=html.replace('</body>',`<script>(${adminBillingUi.toString()})();</script></body>`); res.statusCode=200; res.setHeader('Content-Type','text/html; charset=utf-8'); res.end(html); }catch(e){ return false; }
    return true;
  }
  if(req.method==='GET' && p==='/api/admin/billing'){
    const user=auth(req,res,'admin'); if(!user)return true; const db=dbOpen();
    const q=`SELECT i.id,i.job_id,i.firma_id,i.fahrer_id,i.fahrerlohn,i.gebuehr,i.gesamt,i.zahlungsstatus,i.auszahlungsstatus,i.bezahlt_am,i.auszahlung_freigegeben_am,i.ausgezahlt_am,i.created_at,j.titel,j.status AS job_status,f.name AS firma_name,f.email AS firma_email,d.name AS fahrer_name,d.email AS fahrer_email FROM invoices i JOIN jobs j ON j.id=i.job_id JOIN users f ON f.id=i.firma_id JOIN users d ON d.id=i.fahrer_id ORDER BY i.created_at DESC`;
    db.all(q,[],(e,invoices)=>{if(e){db.close();return json(res,500,{error:'Rechnungen konnten nicht geladen werden.'});}
      db.all(`SELECT j.id,j.titel,j.preis,j.status,j.firma_id,f.name AS firma_name,a.fahrer_id,d.name AS fahrer_name,i.id AS invoice_id FROM jobs j JOIN users f ON f.id=j.firma_id LEFT JOIN applications a ON a.job_id=j.id AND a.status='angenommen' LEFT JOIN users d ON d.id=a.fahrer_id LEFT JOIN invoices i ON i.job_id=j.id WHERE a.fahrer_id IS NOT NULL ORDER BY j.created_at DESC`,[],(e2,jobs)=>{db.close();if(e2)return json(res,500,{error:'Aufträge für die Abrechnung konnten nicht geladen werden.'});
        const sum=(status,field)=>invoices.filter(x=>x.zahlungsstatus===status||x.auszahlungsstatus===status).reduce((n,x)=>n+Number(x[field]||0),0);
        const summary={ausstehend_count:invoices.filter(x=>x.zahlungsstatus==='ausstehend').length,ausstehend_sum:sum('ausstehend','gesamt'),bezahlt_count:invoices.filter(x=>x.zahlungsstatus==='bezahlt').length,bezahlt_sum:invoices.filter(x=>x.zahlungsstatus==='bezahlt').reduce((n,x)=>n+Number(x.gesamt||0),0),freigegeben_count:invoices.filter(x=>x.auszahlungsstatus==='auszahlung_freigegeben').length,freigegeben_sum:invoices.filter(x=>x.auszahlungsstatus==='auszahlung_freigegeben').reduce((n,x)=>n+Number(x.fahrerlohn||0),0),ausgezahlt_count:invoices.filter(x=>x.auszahlungsstatus==='ausgezahlt').length,ausgezahlt_sum:invoices.filter(x=>x.auszahlungsstatus==='ausgezahlt').reduce((n,x)=>n+Number(x.fahrerlohn||0),0)};
        json(res,200,{invoices,jobs,summary});
      });
    }); return true;
  }
  if(req.method==='POST' && p==='/api/admin/invoices'){
    const user=auth(req,res,'admin'); if(!user)return true; readBody(req,data=>{const jobId=Number(data.job_id),fahrerlohn=Number(data.fahrerlohn),gebuehr=Number(data.gebuehr);if(!Number.isInteger(jobId)||fahrerlohn<0||gebuehr<0)return json(res,400,{error:'Ungültige Rechnungsdaten.'});const db=dbOpen();db.get('SELECT j.*,a.fahrer_id FROM jobs j LEFT JOIN applications a ON a.job_id=j.id AND a.status=\'angenommen\' WHERE j.id=?',[jobId],(e,job)=>{if(e||!job){db.close();return json(res,404,{error:'Auftrag oder ausgewählter Fahrer nicht gefunden.'});}if(!job.fahrer_id){db.close();return json(res,409,{error:'Für diesen Auftrag wurde noch kein Fahrer ausgewählt.'});}db.get('SELECT id FROM invoices WHERE job_id=? ORDER BY id DESC LIMIT 1',[jobId],(e2,existing)=>{if(existing){db.close();return json(res,409,{error:'Für diesen Auftrag existiert bereits eine Rechnung.'});}const gesamt=fahrerlohn+gebuehr;db.run('INSERT INTO invoices (job_id,firma_id,fahrer_id,fahrerlohn,gebuehr,gesamt) VALUES (?,?,?,?,?,?)',[jobId,job.firma_id,job.fahrer_id,fahrerlohn,gebuehr,gesamt],function(e3){db.close();if(e3)return json(res,500,{error:'Rechnung konnte nicht erstellt werden.'});json(res,201,{success:true,message:'Rechnung wurde erstellt.',invoice:{id:this.lastID,job_id:jobId,fahrerlohn,gebuehr,gesamt}});});});});});return true;
  }
  if(req.method==='POST' && /^\/api\/admin\/invoices\/\d+\/(pay|release|payout)$/.test(p)){
    const user=auth(req,res,'admin'); if(!user)return true;const m=p.match(/^\/api\/admin\/invoices\/(\d+)\/(pay|release|payout)$/),id=Number(m[1]),action=m[2],db=dbOpen();
    db.get('SELECT * FROM invoices WHERE id=?',[id],(e,i)=>{if(e||!i){db.close();return json(res,404,{error:'Rechnung nicht gefunden.'});}
      let sql=null,message='';
      if(action==='pay'){if(i.zahlungsstatus!=='ausstehend'){db.close();return json(res,409,{error:'Diese Rechnung ist bereits als bezahlt markiert.'});}sql="UPDATE invoices SET zahlungsstatus='bezahlt',bezahlt_am=CURRENT_TIMESTAMP WHERE id=?";message='Zahlung wurde als bezahlt markiert.';}
      if(action==='release'){if(i.zahlungsstatus!=='bezahlt'||i.auszahlungsstatus!=='gesichert'){db.close();return json(res,409,{error:'Die Fahrerzahlung kann erst nach bestätigtem Zahlungseingang freigegeben werden.'});}sql="UPDATE invoices SET auszahlungsstatus='auszahlung_freigegeben',auszahlung_freigegeben_am=CURRENT_TIMESTAMP WHERE id=?";message='Fahrerzahlung wurde freigegeben.';}
      if(action==='payout'){if(i.auszahlungsstatus!=='auszahlung_freigegeben'){db.close();return json(res,409,{error:'Die Auszahlung muss zuerst freigegeben werden.'});}sql="UPDATE invoices SET auszahlungsstatus='ausgezahlt',ausgezahlt_am=CURRENT_TIMESTAMP WHERE id=?";message='Fahrerzahlung wurde als ausgezahlt markiert.';}
      db.run(sql,[id],e2=>{db.close();if(e2)return json(res,500,{error:'Zahlungsstatus konnte nicht geändert werden.'});json(res,200,{success:true,message});});
    });return true;
  }
  if(req.method==='GET' && p==='/api/jobs'){
    const user=auth(req,res); if(!user)return true; const db=dbOpen();
    db.all(`SELECT j.*, a.fahrer_id AS assigned_fahrer_id FROM jobs j LEFT JOIN applications a ON a.job_id=j.id AND a.status='angenommen' ORDER BY j.created_at DESC`,[],(e,rows)=>{db.close(); if(e)return json(res,500,{error:'Aufträge konnten nicht geladen werden.'}); const enriched=rows.map(j=>({...j,fahrer_id:j.assigned_fahrer_id||null})); if(user.role==='admin')return json(res,200,enriched); if(user.role==='firma')return json(res,200,enriched.filter(j=>Number(j.firma_id)===Number(user.id))); if(user.role==='fahrer')return json(res,200,enriched.filter(j=>j.status==='offen'||Number(j.fahrer_id)===Number(user.id))); return json(res,403,{error:'Keine Berechtigung'});}); return true;
  }
  if(req.method==='POST' && /^\/api\/jobs\/\d+\/select-driver$/.test(p)){
    const user=auth(req,res,'firma'); if(!user)return true; const id=Number(p.split('/')[3]); readBody(req,data=>{const driverId=Number(data.fahrer_id); if(!Number.isInteger(driverId)||driverId<=0)return json(res,400,{error:'Ungültiger Fahrer.'}); const db=dbOpen(); db.get('SELECT * FROM jobs WHERE id=?',[id],(e,job)=>{ if(e||!job){db.close();return json(res,404,{error:'Job nicht gefunden.'})} if(Number(job.firma_id)!==Number(user.id)){db.close();return json(res,403,{error:'Keine Berechtigung für diesen Job.'})} if(job.status!=='offen'){db.close();return json(res,409,{error:'Dieser Job ist bereits vergeben oder nicht mehr offen.'})} db.get('SELECT * FROM applications WHERE job_id=? AND fahrer_id=?',[id,driverId],(e2,a)=>{if(e2||!a){db.close();return json(res,404,{error:'Dieser Fahrer hat sich nicht auf den Job beworben.'})} db.serialize(()=>{db.run('BEGIN');db.run("UPDATE applications SET status=CASE WHEN fahrer_id=? THEN 'angenommen' ELSE 'abgelehnt' END WHERE job_id=?",[driverId,id]);db.run("UPDATE jobs SET status='reserviert' WHERE id=?",[id]);db.run('COMMIT',()=>{db.get('SELECT a.*,u.name AS fahrer_name,u.email AS fahrer_email FROM applications a JOIN users u ON a.fahrer_id=u.id WHERE a.job_id=? AND a.fahrer_id=?',[id,driverId],(e3,selected)=>{db.close();if(e3)return json(res,500,{error:'Fahrer konnte nicht ausgewählt werden.'});json(res,200,{success:true,message:'Fahrer wurde ausgewählt.',job:{id,status:'reserviert',fahrer_id:driverId},application:selected});});});});});});}); return true;
  }
  if(req.method==='POST' && /^\/api\/jobs\/\d+\/(start|complete)$/.test(p)){
    const user=auth(req,res,'fahrer'); if(!user)return true; const m=p.match(/^\/api\/jobs\/(\d+)\/(start|complete)$/); const id=Number(m[1]), action=m[2], db=dbOpen();
    db.get("SELECT j.*,a.fahrer_id FROM jobs j LEFT JOIN applications a ON a.job_id=j.id AND a.status='angenommen' WHERE j.id=?",[id],(e,job)=>{
      if(e||!job){db.close();return json(res,404,{error:'Auftrag nicht gefunden.'});}
      if(Number(job.fahrer_id)!==Number(user.id)){db.close();return json(res,403,{error:'Dieser Auftrag gehört nicht dir.'});}
      const from=action==='start'?'reserviert':'gestartet', to=action==='start'?'gestartet':'abgeschlossen';
      if(job.status!==from){db.close();return json(res,409,{error:`Der Auftrag kann nur aus dem Status ${from} ${action==='start'?'gestartet':'abgeschlossen'} werden.`});}
      db.run('UPDATE jobs SET status=? WHERE id=?',[to,id],err=>{db.close(); if(err)return json(res,500,{error:'Auftragsstatus konnte nicht geändert werden.'}); json(res,200,{success:true,status:to});});
    }); return true;
  }
  if(req.method==='GET' && p==='/api/driver/applications'){
    const user=auth(req,res,'fahrer'); if(!user)return true; const db=dbOpen();
    db.all(`SELECT a.id,a.job_id,a.status,a.created_at,j.titel,j.beschreibung,j.preis,j.vehicle_type,j.status AS job_status,j.firma_id FROM applications a JOIN jobs j ON j.id=a.job_id WHERE a.fahrer_id=? ORDER BY a.created_at DESC`,[user.id],(e,rows)=>{db.close(); if(e)return json(res,500,{error:'Bewerbungen konnten nicht geladen werden.'}); json(res,200,rows);}); return true;
  }
  return false;
}
http.Server.prototype.emit = function(type,...args){
  if(type==='request'){ const [req,res]=args; if(handle(req,res)) return true; }
  return originalEmit.call(this,type,...args);
};
