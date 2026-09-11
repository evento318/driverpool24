const http = require('http');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3');
const BetterSqlite3 = require('better-sqlite3');

const originalEmit = http.Server.prototype.emit;
function dbOpen(){ return new sqlite3.Database(process.env.DATABASE_PATH || './driverpool24.db'); }
function auth(req,res,role){
  const h=req.headers.authorization||''; const token=h.startsWith('Bearer ')?h.slice(7):null;
  if(!token){res.statusCode=401;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:'Anmeldung erforderlich'}));return null;}
  try{ const secret=process.env.JWT_SECRET || (process.env.NODE_ENV==='production'?null:'dev-secret'); if(!secret) throw Error(); const u=jwt.verify(token,secret); if(role&&u.role!==role){res.statusCode=403;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:'Keine Berechtigung'}));return null;} return u; }catch(e){res.statusCode=401;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:'Sitzung abgelaufen. Bitte erneut anmelden.'}));return null;}
}
function json(res,status,data){res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(data));}
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

function handle(req,res){
  const u=new URL(req.url,'http://localhost'); const p=u.pathname;
  if(req.method==='GET' && p==='/driver.html'){
    const file=path.join(process.cwd(),'driver.html');
    try{ let html=fs.readFileSync(file,'utf8'); html=html.replace('</body>',`<script>(${driverUi.toString()})();</script></body>`); res.statusCode=200; res.setHeader('Content-Type','text/html; charset=utf-8'); res.end(html); }catch(e){ return false; }
    return true;
  }
  if(req.method==='GET' && p==='/api/jobs'){
    const user=auth(req,res); if(!user)return true; const db=dbOpen();
    db.all(`SELECT j.*, a.fahrer_id AS assigned_fahrer_id FROM jobs j LEFT JOIN applications a ON a.job_id=j.id AND a.status='angenommen' ORDER BY j.created_at DESC`,[],(e,rows)=>{db.close(); if(e)return json(res,500,{error:'Aufträge konnten nicht geladen werden.'}); const enriched=rows.map(j=>({...j,fahrer_id:j.assigned_fahrer_id||j.fahrer_id||null})); if(user.role==='admin')return json(res,200,enriched); if(user.role==='firma')return json(res,200,enriched.filter(j=>Number(j.firma_id)===Number(user.id))); if(user.role==='fahrer')return json(res,200,enriched.filter(j=>j.status==='offen'||Number(j.fahrer_id)===Number(user.id))); return json(res,403,{error:'Keine Berechtigung'});}); return true;
  }
  if(req.method==='POST' && /^\/api\/jobs\/\d+\/select-driver$/.test(p)){
    const user=auth(req,res,'firma'); if(!user)return true; const id=Number(p.split('/')[3]); let body=''; req.on('data',c=>body+=c); req.on('end',()=>{let data={};try{data=JSON.parse(body||'{}')}catch{} const driverId=Number(data.fahrer_id); if(!Number.isInteger(driverId)||driverId<=0)return json(res,400,{error:'Ungültiger Fahrer.'}); const db=dbOpen(); db.get('SELECT * FROM jobs WHERE id=?',[id],(e,job)=>{ if(e||!job){db.close();return json(res,404,{error:'Job nicht gefunden.'})} if(Number(job.firma_id)!==Number(user.id)){db.close();return json(res,403,{error:'Keine Berechtigung für diesen Job.'})} if(job.status!=='offen'){db.close();return json(res,409,{error:'Dieser Job ist bereits vergeben oder nicht mehr offen.'})} db.get('SELECT * FROM applications WHERE job_id=? AND fahrer_id=?',[id,driverId],(e2,a)=>{if(e2||!a){db.close();return json(res,404,{error:'Dieser Fahrer hat sich nicht auf den Job beworben.'})} db.serialize(()=>{db.run('BEGIN');db.run("UPDATE applications SET status=CASE WHEN fahrer_id=? THEN 'angenommen' ELSE 'abgelehnt' END WHERE job_id=?",[driverId,id]);db.run("UPDATE jobs SET status='reserviert', fahrer_id=? WHERE id=?",[driverId,id]);db.run('COMMIT',()=>{db.get('SELECT a.*,u.name AS fahrer_name,u.email AS fahrer_email FROM applications a JOIN users u ON a.fahrer_id=u.id WHERE a.job_id=? AND a.fahrer_id=?',[id,driverId],(e3,selected)=>{db.close();if(e3)return json(res,500,{error:'Fahrer konnte nicht ausgewählt werden.'});json(res,200,{success:true,message:'Fahrer wurde ausgewählt.',job:{id,status:'reserviert',fahrer_id:driverId},application:selected});});});});});});}); return true;
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
try{ const db=new BetterSqlite3(process.env.DATABASE_PATH||'./driverpool24.db'); const cols=db.prepare('PRAGMA table_info(jobs)').all(); if(!cols.some(c=>c.name==='fahrer_id')) db.exec('ALTER TABLE jobs ADD COLUMN fahrer_id INTEGER'); db.close(); }catch(e){ console.error('workflow migration:',e); }
