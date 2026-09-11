const http = require('http');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3');

const previousEmit = http.Server.prototype.emit;

function dbOpen(){
  return new sqlite3.Database(process.env.DATABASE_PATH || './driverpool24.db');
}
function json(res,status,data){
  res.statusCode=status;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}
function readBody(req,done){
  let body='';
  req.on('data',c=>body+=c);
  req.on('end',()=>{try{done(JSON.parse(body||'{}'));}catch{done({});}});
}
function auth(req,res,role){
  const h=req.headers.authorization||'';
  const token=h.startsWith('Bearer ')?h.slice(7):null;
  if(!token){json(res,401,{error:'Anmeldung erforderlich'});return null;}
  try{
    const secret=process.env.JWT_SECRET || (process.env.NODE_ENV==='production'?null:'dev-secret');
    if(!secret) throw Error();
    const u=jwt.verify(token,secret);
    if(role && u.role!==role){json(res,403,{error:'Keine Berechtigung'});return null;}
    return u;
  }catch{
    json(res,401,{error:'Sitzung abgelaufen. Bitte erneut anmelden.'});return null;
  }
}
function ensureTables(db,cb){
  db.serialize(()=>{
    db.run(`CREATE TABLE IF NOT EXISTS replacement_sos_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      firma_id INTEGER NOT NULL,
      von TEXT NOT NULL,
      nach TEXT NOT NULL,
      region TEXT NOT NULL,
      benoetigt_ab TEXT NOT NULL,
      anzahl_fahrer INTEGER NOT NULL DEFAULT 1,
      dauer_tage INTEGER NOT NULL DEFAULT 1,
      fahrerlohn_pro_tag REAL NOT NULL,
      grund TEXT NOT NULL,
      vermittlungsgebuehr_pro_tag REAL NOT NULL DEFAULT 150,
      status TEXT NOT NULL DEFAULT 'offen',
      selected_fahrer_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      selected_at DATETIME,
      FOREIGN KEY (firma_id) REFERENCES users(id),
      FOREIGN KEY (selected_fahrer_id) REFERENCES users(id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS replacement_sos_optins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id INTEGER NOT NULL,
      fahrer_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'interessiert',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(request_id,fahrer_id),
      FOREIGN KEY (request_id) REFERENCES replacement_sos_requests(id),
      FOREIGN KEY (fahrer_id) REFERENCES users(id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS replacement_sos_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id INTEGER NOT NULL,
      type TEXT NOT NULL DEFAULT 'neue_sos_anfrage',
      gelesen INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (request_id) REFERENCES replacement_sos_requests(id)
    )`);
    db.all('PRAGMA table_info(users)',(e,cols)=>{
      if(e) return cb(e);
      const names=new Set((cols||[]).map(x=>x.name));
      if(names.has('region')) return cb(null);
      db.run("ALTER TABLE users ADD COLUMN region TEXT",cb);
    });
  });
}

function companyReplacementUi(){
  const token=localStorage.getItem('driverpool24_token');
  const raw=localStorage.getItem('driverpool24_user');
  if(!token||!raw)return;
  let user;try{user=JSON.parse(raw)}catch{return}
  if(user.role!=='firma')return;
  const H={'Authorization':'Bearer '+token,'Content-Type':'application/json'};
  const api=(u,o={})=>fetch(u,{...o,headers:{...H,...(o.headers||{})}});
  const esc=s=>String(s??'').replace(/[&<>\"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
  const money=v=>Number(v||0).toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2})+' €';
  const style=document.createElement('style');
  style.textContent='.replacement-sos{border:2px solid #dc2626!important;background:#fff7f7!important}.replacement-sos h2{color:#991b1b!important}.replacement-sos .sosbtn{background:#dc2626;color:#fff}.replacement-sos .calc{background:#fff;border:1px solid #fecaca;border-radius:10px;padding:12px;margin-top:12px}.replacement-sos .hint{font-size:13px;color:#7f1d1d;line-height:1.5}';
  document.head.appendChild(style);
  const main=document.querySelector('main'); if(!main||document.getElementById('replacementSosPanel'))return;
  const section=document.createElement('section');
  section.id='replacementSosPanel';
  section.className='panel wide replacement-sos';
  section.innerHTML=`<h2>🆘 Sofort-Ersatzfahrer anfordern</h2>
  <p class="hint"><strong>Wann nutze ich das?</strong> Wenn dein eigener Fahrer kurzfristig ausfällt (krank, verhindert o.ä.) und du sofort Ersatz brauchst. Bei echten Notfällen (Unfall, Gesundheit) bitte trotzdem zuerst 112/110 anrufen.</p>
  <form id="replacementSosForm"><div class="form-grid">
    <div><label>Von</label><input id="rsVon" required placeholder="Startort / Adresse"></div>
    <div><label>Nach</label><input id="rsNach" required placeholder="Zielort / Adresse"></div>
    <div><label>Region</label><select id="rsRegion" required><option value="">Bitte wählen</option><option>Nord</option><option>Süd</option><option>West</option><option>Ost</option><option>Mitte</option></select></div>
    <div><label>Wird benötigt ab</label><input id="rsAb" type="datetime-local" required></div>
    <div><label>Anzahl Ersatzfahrer</label><input id="rsAnzahl" type="number" min="1" max="50" value="1" required></div>
    <div><label>Dauer (Tage)</label><input id="rsDauer" type="number" min="1" max="365" value="1" required></div>
    <div><label>Fahrerlohn pro Tag</label><input id="rsLohn" type="number" min="0" step="0.01" placeholder="z. B. 250" required></div>
    <div><label>Grund</label><select id="rsGrund" required><option>Fahrer krankheitsbedingt ausgefallen</option><option>Fahrer kurzfristig verhindert</option><option>Zusätzlicher Bedarf</option><option>Sonstiges</option></select></div>
  </div>
  <div class="calc" id="rsCalc">Voraussichtlicher Gesamtbetrag: <strong>0,00 €</strong><br><span class="hint">150 €/Tag Vermittlungsgebühr + Fahrerlohn. Die Abrechnung entsteht erst nach Auswahl eines Fahrers.</span></div>
  <button class="sosbtn" style="margin-top:14px" type="submit">🆘 Ersatzfahrer jetzt anfordern</button><div id="replacementSosMsg" class="msg"></div></form>
  <div id="replacementSosList" style="margin-top:18px"></div>`;
  main.insertBefore(section,main.firstChild);
  const form=section.querySelector('#replacementSosForm');
  const calc=()=>{const n=Number(rsAnzahl.value||0),d=Number(rsDauer.value||0),l=Number(rsLohn.value||0);rsCalc.innerHTML='Voraussichtlicher Gesamtbetrag: <strong>'+money((150+l)*n*d)+'</strong><br><span class="hint">150 €/Tag Vermittlungsgebühr + Fahrerlohn. Die Abrechnung entsteht erst nach Auswahl eines Fahrers.</span>'};
  ['rsAnzahl','rsDauer','rsLohn'].forEach(id=>document.getElementById(id).addEventListener('input',calc));
  form.addEventListener('submit',async e=>{
    e.preventDefault();
    try{
      const payload={von:rsVon.value.trim(),nach:rsNach.value.trim(),region:rsRegion.value,benoetigt_ab:rsAb.value,anzahl_fahrer:Number(rsAnzahl.value),dauer_tage:Number(rsDauer.value),fahrerlohn_pro_tag:Number(rsLohn.value),grund:rsGrund.value};
      const r=await api('/api/replacement-sos',{method:'POST',body:JSON.stringify(payload)});
      const d=await r.json(); if(!r.ok)throw Error(d.error||'SOS-Anfrage konnte nicht erstellt werden.');
      replacementSosMsg.textContent='🔴 SOS-Anfrage #'+d.request.id+' wurde sofort an passende Fahrer in der Region gesendet. Der Admin wurde benachrichtigt.';
      replacementSosMsg.className='msg ok'; form.reset();rsAnzahl.value='1';rsDauer.value='1';calc();loadReplacementSos();
    }catch(err){replacementSosMsg.textContent=err.message;replacementSosMsg.className='msg err'}
  });
  async function loadReplacementSos(){
    const r=await api('/api/replacement-sos/company'); if(!r.ok)return; const rows=await r.json();
    replacementSosList.innerHTML=rows.length?'<h3>Meine SOS-Anfragen</h3>'+rows.map(x=>{
      const opts=String(x.optin_drivers||'').split(';;').filter(Boolean).map(v=>{const p=v.split('|');return '<button class="outline" onclick="selectReplacementDriver('+x.id+','+Number(p[0])+')">👷 '+esc(p.slice(1).join('|'))+' auswählen</button>'}).join(' ');
      return '<div class="job" style="border-color:#fecaca"><strong>🆘 #'+x.id+' · '+esc(x.von)+' → '+esc(x.nach)+'</strong><div class="meta">Region: '+esc(x.region)+' · ab: '+esc(x.benoetigt_ab)+' · '+x.anzahl_fahrer+' Fahrer · '+x.dauer_tage+' Tage</div><div class="meta">Fahrerlohn: '+money(x.fahrerlohn_pro_tag)+'/Tag · Vermittlung: '+money(x.vermittlungsgebuehr_pro_tag)+'/Tag · Status: '+esc(x.status)+'</div>'+(x.optins_count?'<div class="meta">👷 Interessierte Fahrer: '+x.optins_count+'</div><div class="actions" style="margin-top:10px">'+opts+'</div>':'<div class="meta">Noch kein Fahrer hat sich gemeldet.</div>')+'</div>';
    }).join(''):'';
  }
  window.selectReplacementDriver=async (id,driver)=>{
    const r=await api('/api/replacement-sos/'+id+'/select-driver',{method:'POST',body:JSON.stringify({fahrer_id:Number(driver)})});
    const d=await r.json();alert(d.error||d.message||'Auswahl gespeichert.');if(r.ok)loadReplacementSos();
  };
  loadReplacementSos();
}

function driverReplacementUi(){
  const token=localStorage.getItem('driverpool24_token'),raw=localStorage.getItem('driverpool24_user');
  if(!token||!raw)return;let user;try{user=JSON.parse(raw)}catch{return}if(user.role!=='fahrer')return;
  const H={'Authorization':'Bearer '+token,'Content-Type':'application/json'};
  const api=(u,o={})=>fetch(u,{...o,headers:{...H,...(o.headers||{})}});
  const esc=s=>String(s??'').replace(/[&<>\"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
  const main=document.querySelector('main');if(!main||document.getElementById('replacementDriverSos'))return;
  const section=document.createElement('section');section.id='replacementDriverSos';section.className='panel sos wide';
  section.innerHTML='<h2>🆘 Sofort-Ersatzfahrer-Anfragen</h2><p class="muted">Hier erscheinen dringende Ersatzfahrer-Anfragen deiner Einsatzregion. Du entscheidest selbst, ob du dich meldest.</p><div style="margin:10px 0"><label>Einsatzregion</label><select id="driverReplacementRegion"><option value="">Nicht festgelegt</option><option>Nord</option><option>Süd</option><option>West</option><option>Ost</option><option>Mitte</option></select> <button class="outline" id="saveDriverReplacementRegion">Region speichern</button></div><div id="replacementDriverRegionMsg" class="msg"></div><div id="replacementDriverSosList"><div class="empty">Anfragen werden geladen …</div></div>';
  main.insertBefore(section,main.firstChild);
  const regionSelect=document.getElementById('driverReplacementRegion');
  const regionMsg=document.getElementById('replacementDriverRegionMsg');
  async function loadRegion(){const r=await api('/api/driver/region');if(r.ok){const d=await r.json();regionSelect.value=d.region||''}}
  document.getElementById('saveDriverReplacementRegion').onclick=async()=>{const r=await api('/api/driver/region',{method:'PUT',body:JSON.stringify({region:regionSelect.value})});const d=await r.json();regionMsg.textContent=d.error||'✓ Einsatzregion gespeichert.';regionMsg.className='msg '+(r.ok?'ok':'err');if(r.ok)load()};
  async function load(){const r=await api('/api/driver/replacement-sos');const d=await r.json();if(!r.ok){replacementDriverSosList.innerHTML='<div class="empty">'+esc(d.error||'Fehler')+'</div>';return}replacementDriverSosList.innerHTML=d.length?d.map(x=>`<div class="sosjob"><strong>🔴 #${x.id} · ${esc(x.von)} → ${esc(x.nach)}</strong><div class="meta">Region: ${esc(x.region)} · ab: ${esc(x.benoetigt_ab)} · ${x.dauer_tage} Tage · ${x.anzahl_fahrer} Fahrer</div><div class="meta">Fahrerlohn: <strong>${Number(x.fahrerlohn_pro_tag||0).toLocaleString('de-DE',{minimumFractionDigits:2})} € / Tag</strong></div><div class="bonus">🆘 Sofort-Einsatz</div><button class="primary" onclick="optReplacementSos(${x.id})">🙋 Ich bin verfügbar</button></div>`).join(''):'<div class="empty">Aktuell keine passenden SOS-Anfragen.</div>'}
  window.optReplacementSos=async id=>{const r=await api('/api/driver/replacement-sos/'+id+'/opt-in',{method:'POST',body:'{}'});const d=await r.json();alert(d.error||d.message||'Verfügbarkeit gemeldet.');if(r.ok)load()};loadRegion();load();setInterval(load,30000);
}

function adminReplacementUi(){
  const token=localStorage.getItem('driverpool24_admin_token'),raw=localStorage.getItem('driverpool24_admin_user');
  if(!token||!raw)return;let user;try{user=JSON.parse(raw)}catch{return}if(user.role!=='admin')return;
  const H={'Authorization':'Bearer '+token,'Content-Type':'application/json'};const api=(u,o={})=>fetch(u,{...o,headers:{...H,...(o.headers||{})}});
  const esc=s=>String(s??'').replace(/[&<>\"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
  const main=document.querySelector('main');if(!main||document.getElementById('replacementAdminSos'))return;
  const section=document.createElement('section');section.id='replacementAdminSos';section.className='card wide';section.style.margin='20px 0';section.innerHTML='<h2>🆘 Sofort-Ersatzfahrer – Admin</h2><div id="replacementAdminSosList">Wird geladen …</div>';main.appendChild(section);
  async function load(){const r=await api('/api/admin/replacement-sos');const d=await r.json();if(!r.ok){replacementAdminSosList.textContent=d.error||'Fehler';return}replacementAdminSosList.innerHTML=d.length?d.map(x=>`<div class="row" style="display:block;margin-bottom:10px"><b>🔴 #${x.id} · ${esc(x.firma_name)} · ${esc(x.region)}</b><div class="muted">${esc(x.von)} → ${esc(x.nach)} · ab ${esc(x.benoetigt_ab)} · ${x.anzahl_fahrer} Fahrer · ${x.dauer_tage} Tage</div><div class="muted">Fahrerlohn ${Number(x.fahrerlohn_pro_tag||0).toLocaleString('de-DE',{minimumFractionDigits:2})} €/Tag · Vermittlung 150 €/Tag · Status: ${esc(x.status)} · Interessenten: ${x.optins_count}</div></div>`).join(''):'Keine offenen SOS-Anfragen.'}load();setInterval(load,15000);
}

function serveHtml(req,res,file,injectFn){
  try{
    const fs=require('fs'),path=require('path');
    let html=fs.readFileSync(path.join(process.cwd(),file),'utf8');
    html=html.replace('</body>',`<script>(${injectFn.toString()})();</script></body>`);
    res.statusCode=200;res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return true;
  }catch{return false}
}

function handle(req,res){
  const u=new URL(req.url,'http://localhost'),p=u.pathname;
  if(req.method==='GET'&&p==='/company.html')return serveHtml(req,res,'company.html',companyReplacementUi);
  if(req.method==='GET'&&p==='/driver.html')return serveHtml(req,res,'driver.html',driverReplacementUi);
  if(req.method==='GET'&&p==='/admin.html')return serveHtml(req,res,'admin.html',adminReplacementUi);

  if(req.method==='POST'&&p==='/api/replacement-sos'){
    const user=auth(req,res,'firma');if(!user)return true;
    readBody(req,data=>{
      const n=Number(data.anzahl_fahrer),days=Number(data.dauer_tage),pay=Number(data.fahrerlohn_pro_tag);
      const regions=new Set(['Nord','Süd','West','Ost','Mitte']);
      const reasons=new Set(['Fahrer krankheitsbedingt ausgefallen','Fahrer kurzfristig verhindert','Zusätzlicher Bedarf','Sonstiges']);
      if(!String(data.von||'').trim()||!String(data.nach||'').trim()||!regions.has(data.region)||!String(data.benoetigt_ab||'').trim()||!Number.isInteger(n)||n<1||!Number.isInteger(days)||days<1||!Number.isFinite(pay)||pay<0||!reasons.has(data.grund))return json(res,400,{error:'Bitte alle Ersatzfahrer-Daten korrekt ausfüllen.'});
      const db=dbOpen();ensureTables(db,(e)=>{
        if(e){db.close();return json(res,500,{error:'SOS-System konnte nicht vorbereitet werden.'});}
        db.run(`INSERT INTO replacement_sos_requests (firma_id,von,nach,region,benoetigt_ab,anzahl_fahrer,dauer_tage,fahrerlohn_pro_tag,grund) VALUES (?,?,?,?,?,?,?,?,?)`,
          [user.id,String(data.von).trim(),String(data.nach).trim(),data.region,String(data.benoetigt_ab),n,days,pay,data.grund],function(err){
            if(err){db.close();return json(res,500,{error:'SOS-Anfrage konnte nicht gespeichert werden.'});}
            const id=this.lastID;
            db.run('INSERT INTO replacement_sos_notifications (request_id,type) VALUES (?,?)',[id,'neue_sos_anfrage'],()=>{db.close();json(res,201,{success:true,message:'SOS-Anfrage wurde erstellt.',request:{id}});});
          });
      });
    });return true;
  }

  if(req.method==='GET'&&p==='/api/replacement-sos/company'){
    const user=auth(req,res,'firma');if(!user)return true;const db=dbOpen();ensureTables(db,e=>{
      if(e){db.close();return json(res,500,{error:'SOS-System konnte nicht geladen werden.'});}
      db.all(`SELECT r.*,
        COALESCE((SELECT COUNT(*) FROM replacement_sos_optins o WHERE o.request_id=r.id AND o.status='interessiert'),0) AS optins_count,
        COALESCE((SELECT GROUP_CONCAT(d.id || '|' || d.name, ';;') FROM replacement_sos_optins o JOIN users d ON d.id=o.fahrer_id WHERE o.request_id=r.id AND o.status='interessiert'),'') AS optin_drivers
        FROM replacement_sos_requests r WHERE r.firma_id=? ORDER BY r.created_at DESC`,[user.id],(err,rows)=>{db.close();if(err)return json(res,500,{error:'SOS-Anfragen konnten nicht geladen werden.'});json(res,200,rows)});
    });return true;
  }

  if(req.method==='GET'&&p==='/api/driver/region'){
    const user=auth(req,res,'fahrer');if(!user)return true;const db=dbOpen();db.get('SELECT COALESCE(region,\'\') AS region FROM users WHERE id=?',[user.id],(e,row)=>{db.close();if(e)return json(res,500,{error:'Region konnte nicht geladen werden.'});json(res,200,{region:row?.region||''})});return true;
  }
  if(req.method==='PUT'&&p==='/api/driver/region'){
    const user=auth(req,res,'fahrer');if(!user)return true;readBody(req,data=>{const allowed=new Set(['Nord','Süd','West','Ost','Mitte']);if(data.region && !allowed.has(data.region))return json(res,400,{error:'Ungültige Einsatzregion.'});const db=dbOpen();db.run('UPDATE users SET region=? WHERE id=?',[data.region||null,user.id],e=>{db.close();if(e)return json(res,500,{error:'Region konnte nicht gespeichert werden.'});json(res,200,{success:true,region:data.region||''})});});return true;
  }

  if(req.method==='GET'&&p==='/api/driver/replacement-sos'){
    const user=auth(req,res,'fahrer');if(!user)return true;const db=dbOpen();ensureTables(db,e=>{
      if(e){db.close();return json(res,500,{error:'SOS-System konnte nicht geladen werden.'});}
      db.get('SELECT region FROM users WHERE id=?',[user.id],(e1,me)=>{
        if(e1){db.close();return json(res,500,{error:'Fahrerregion konnte nicht geladen werden.'});}
        const region=me&&me.region?me.region:null;
        const sql=region
          ? `SELECT r.* FROM replacement_sos_requests r WHERE r.status='offen' AND r.region=? AND NOT EXISTS (SELECT 1 FROM replacement_sos_optins o WHERE o.request_id=r.id AND o.fahrer_id=?) ORDER BY r.created_at DESC`
          : `SELECT r.* FROM replacement_sos_requests r WHERE r.status='offen' AND NOT EXISTS (SELECT 1 FROM replacement_sos_optins o WHERE o.request_id=r.id AND o.fahrer_id=?) ORDER BY r.created_at DESC`;
        const params=region?[region,user.id]:[user.id];
        db.all(sql,params,(err,rows)=>{db.close();if(err)return json(res,500,{error:'SOS-Anfragen konnten nicht geladen werden.'});json(res,200,rows)});
      });
    });return true;
  }

  if(req.method==='POST'&&/^\/api\/driver\/replacement-sos\/\d+\/opt-in$/.test(p)){
    const user=auth(req,res,'fahrer');if(!user)return true;const id=Number(p.split('/')[4]);const db=dbOpen();ensureTables(db,e=>{
      if(e){db.close();return json(res,500,{error:'SOS-System konnte nicht geladen werden.'});}
      db.get('SELECT * FROM replacement_sos_requests WHERE id=? AND status=\'offen\'',[id],(e1,r)=>{
        if(e1||!r){db.close();return json(res,404,{error:'SOS-Anfrage nicht gefunden oder bereits vergeben.'});}
        db.get('SELECT region FROM users WHERE id=?',[user.id],(e2,me)=>{
          if(e2){db.close();return json(res,500,{error:'Fahrerregion konnte nicht geprüft werden.'});}
          if(me&&me.region&&me.region!==r.region){db.close();return json(res,403,{error:'Diese SOS-Anfrage gehört nicht zu deiner Einsatzregion.'});}
          db.run('INSERT OR IGNORE INTO replacement_sos_optins (request_id,fahrer_id) VALUES (?,?)',[id,user.id],function(err){db.close();if(err)return json(res,500,{error:'Verfügbarkeit konnte nicht gespeichert werden.'});json(res,201,{success:true,message:'Verfügbarkeit für den SOS-Einsatz wurde gemeldet.'});});
        });
      });
    });return true;
  }

  if(req.method==='POST'&&/^\/api\/replacement-sos\/\d+\/select-driver$/.test(p)){
    const user=auth(req,res,'firma');if(!user)return true;const id=Number(p.split('/')[3]);
    readBody(req,data=>{const driverId=Number(data.fahrer_id);if(!Number.isInteger(driverId))return json(res,400,{error:'Ungültige Fahrer-ID.'});const db=dbOpen();ensureTables(db,e=>{
      if(e){db.close();return json(res,500,{error:'SOS-System konnte nicht geladen werden.'});}
      db.get(`SELECT r.*,o.id AS optin_id FROM replacement_sos_requests r JOIN replacement_sos_optins o ON o.request_id=r.id AND o.fahrer_id=? AND o.status='interessiert' WHERE r.id=? AND r.firma_id=? AND r.status='offen'`,[driverId,id,user.id],(e1,r)=>{
        if(e1||!r){db.close();return json(res,404,{error:'Dieser Fahrer hat sich für die SOS-Anfrage nicht gemeldet oder die Anfrage ist nicht mehr offen.'});}
        db.run(`UPDATE replacement_sos_requests SET status='ausgewaehlt',selected_fahrer_id=?,selected_at=CURRENT_TIMESTAMP WHERE id=?`,[driverId,id],e2=>{
          if(e2){db.close();return json(res,500,{error:'Fahrer konnte nicht ausgewählt werden.'});}
          db.run(`UPDATE replacement_sos_optins SET status=CASE WHEN fahrer_id=? THEN 'ausgewaehlt' ELSE 'nicht_ausgewaehlt' END WHERE request_id=?`,[driverId,id],()=>{
            const total=(Number(r.fahrerlohn_pro_tag)+Number(r.vermittlungsgebuehr_pro_tag))*Number(r.dauer_tage);
            const invoiceJobTitle='SOS-Ersatzfahrer #'+id+': '+r.von+' → '+r.nach;
            db.run(`INSERT INTO jobs (firma_id,titel,beschreibung,preis,status,vehicle_type) VALUES (?,?,?,?,?,?)`,
              [user.id,invoiceJobTitle,'SOS-Ersatzfahrer · '+r.grund+' · Region '+r.region,r.fahrerlohn_pro_tag,'reserviert','SOS'],function(e3){
                if(e3){db.close();return json(res,500,{error:'SOS-Auftrag konnte nicht für die Abrechnung angelegt werden.'});}
                const jobId=this.lastID;
                db.run(`INSERT INTO applications (job_id,fahrer_id,status) VALUES (?,?,?)`,[jobId,driverId,'angenommen'],function(e4){
                  if(e4){db.close();return json(res,500,{error:'SOS-Fahrer konnte nicht dem Abrechnungsauftrag zugeordnet werden.'});}
                  db.run(`INSERT INTO invoices (job_id,firma_id,fahrer_id,fahrerlohn,gebuehr,gesamt) VALUES (?,?,?,?,?,?)`,
                    [jobId,user.id,driverId,Number(r.fahrerlohn_pro_tag)*Number(r.dauer_tage),Number(r.vermittlungsgebuehr_pro_tag)*Number(r.dauer_tage),total],function(e5){
                      db.close();if(e5)return json(res,500,{error:'SOS-Rechnung konnte nicht erstellt werden.'});
                      json(res,201,{success:true,message:'Fahrer ausgewählt. Die Zahlung ist jetzt fällig.',invoice_id:this.lastID,gesamt:total});
                    });
                });
              });
          });
        });
      });
    });});return true;
  }

  if(req.method==='GET'&&p==='/api/admin/replacement-sos'){
    const user=auth(req,res,'admin');if(!user)return true;const db=dbOpen();ensureTables(db,e=>{
      if(e){db.close();return json(res,500,{error:'SOS-System konnte nicht geladen werden.'});}
      db.all(`SELECT r.*,u.name AS firma_name,(SELECT COUNT(*) FROM replacement_sos_optins o WHERE o.request_id=r.id AND o.status='interessiert') AS optins_count
        FROM replacement_sos_requests r JOIN users u ON u.id=r.firma_id WHERE r.status='offen' ORDER BY r.created_at DESC`,[],(err,rows)=>{db.close();if(err)return json(res,500,{error:'SOS-Anfragen konnten nicht geladen werden.'});json(res,200,rows)});
    });return true;
  }

  return false;
}

http.Server.prototype.emit=function(event,...args){
  if(event==='request'){
    const req=args[0],res=args[1];
    try{if(handle(req,res))return true;}catch(e){try{json(res,500,{error:'Interner SOS-Fehler.'});}catch{}return true;}
  }
  return previousEmit.call(this,event,...args);
};
