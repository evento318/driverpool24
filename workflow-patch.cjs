const express = require('express');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3');
const BetterSqlite3 = require('better-sqlite3');

const originalListen = express.application.listen;

function dbOpen(){
  return new sqlite3.Database(process.env.DATABASE_PATH || './driverpool24.db');
}
function auth(req,res,role){
  const h=req.headers.authorization||'';
  const token=h.startsWith('Bearer ')?h.slice(7):null;
  if(!token){res.status(401).json({error:'Anmeldung erforderlich'});return null;}
  try{
    const secret=process.env.JWT_SECRET || (process.env.NODE_ENV==='production' ? null : 'dev-secret');
    if(!secret) throw new Error('JWT_SECRET fehlt');
    const user=jwt.verify(token,secret);
    if(role && user.role!==role){res.status(403).json({error:'Keine Berechtigung'});return null;}
    return user;
  }catch(e){res.status(401).json({error:'Sitzung abgelaufen. Bitte erneut anmelden.'});return null;}
}

express.application.listen = function(...args){
  const app=this;
  app.use((req,res,next)=>{
    if(req.method!=='GET' || !['/driver.html','/company.html'].includes(req.path)) return next();
    const file=path.join(process.cwd(),req.path.slice(1));
    fs.readFile(file,'utf8',(err,html)=>{
      if(err) return next();
      const injected=html.replace('</body>','<script src="/workflow-ui.js"></script></body>');
      res.type('html').send(injected);
    });
  });
  app.use('/api/jobs',(req,res,next)=>{
    if(req.method!=='GET' || req.path!=='/' ) return next();
    const user=auth(req,res); if(!user) return;
    const db=dbOpen();
    db.all(`SELECT j.*, a.fahrer_id AS fahrer_id FROM jobs j LEFT JOIN applications a ON a.job_id=j.id AND a.status='angenommen' ORDER BY j.created_at DESC`,[],(err,rows)=>{
      db.close();
      if(err) return res.status(500).json({error:'Aufträge konnten nicht geladen werden.'});
      if(user.role==='admin') return res.json(rows);
      if(user.role==='firma') return res.json(rows.filter(j=>Number(j.firma_id)===Number(user.id)));
      if(user.role==='fahrer') return res.json(rows.filter(j=>j.status==='offen'||Number(j.fahrer_id)===Number(user.id)));
      return res.status(403).json({error:'Keine Berechtigung'});
    });
  });
  app.use('/api/jobs/:id/select-driver',(req,res,next)=>{
    if(req.method!=='POST') return next();
    const user=auth(req,res,'firma'); if(!user) return;
    const driverId=Number(req.body?.fahrer_id); const jobId=Number(req.params.id);
    if(!Number.isInteger(driverId)||driverId<=0||!Number.isInteger(jobId)) return res.status(400).json({error:'Ungültige Daten.'});
    const db=dbOpen();
    db.get('SELECT * FROM jobs WHERE id=?',[jobId],(e,job)=>{
      if(e||!job){db.close();return res.status(404).json({error:'Job nicht gefunden.'});}
      if(Number(job.firma_id)!==Number(user.id)){db.close();return res.status(403).json({error:'Keine Berechtigung für diesen Job.'});}
      if(job.status!=='offen'){db.close();return res.status(409).json({error:'Dieser Job ist bereits vergeben oder nicht mehr offen.'});}
      db.get('SELECT * FROM applications WHERE job_id=? AND fahrer_id=?',[jobId,driverId],(e2,appRow)=>{
        if(e2||!appRow){db.close();return res.status(404).json({error:'Dieser Fahrer hat sich nicht auf den Job beworben.'});}
        db.serialize(()=>{
          db.run('BEGIN');
          db.run("UPDATE applications SET status=CASE WHEN fahrer_id=? THEN 'angenommen' ELSE 'abgelehnt' END WHERE job_id=?",[driverId,jobId]);
          db.run("UPDATE jobs SET status='reserviert', fahrer_id=? WHERE id=?",[driverId,jobId]);
          db.run('COMMIT',()=>{
            db.get('SELECT a.*,u.name AS fahrer_name,u.email AS fahrer_email FROM applications a JOIN users u ON a.fahrer_id=u.id WHERE a.job_id=? AND a.fahrer_id=?',[jobId,driverId],(e4,selected)=>{
              db.close();
              if(e4) return res.status(500).json({error:'Fahrer konnte nicht ausgewählt werden.'});
              res.json({success:true,message:'Fahrer wurde ausgewählt.',job:{id:jobId,status:'reserviert',fahrer_id:driverId},application:selected});
            });
          });
        });
      });
    });
  });
  app.post('/api/jobs/:id/start',(req,res)=>{
    const user=auth(req,res,'fahrer'); if(!user) return;
    const id=Number(req.params.id); const db=dbOpen();
    db.get('SELECT j.*,a.fahrer_id FROM jobs j LEFT JOIN applications a ON a.job_id=j.id AND a.status=\'angenommen\' WHERE j.id=?',[id],(e,job)=>{
      if(e||!job){db.close();return res.status(404).json({error:'Auftrag nicht gefunden.'});}
      if(Number(job.fahrer_id)!==Number(user.id)){db.close();return res.status(403).json({error:'Dieser Auftrag gehört nicht dir.'});}
      if(job.status!=='reserviert'){db.close();return res.status(409).json({error:'Der Auftrag kann nur aus dem Status reserviert gestartet werden.'});}
      db.run("UPDATE jobs SET status='gestartet' WHERE id=?",[id],err=>{db.close();if(err)return res.status(500).json({error:'Auftrag konnte nicht gestartet werden.'});res.json({success:true,status:'gestartet'});});
    });
  });
  app.post('/api/jobs/:id/complete',(req,res)=>{
    const user=auth(req,res,'fahrer'); if(!user) return;
    const id=Number(req.params.id); const db=dbOpen();
    db.get('SELECT j.*,a.fahrer_id FROM jobs j LEFT JOIN applications a ON a.job_id=j.id AND a.status=\'angenommen\' WHERE j.id=?',[id],(e,job)=>{
      if(e||!job){db.close();return res.status(404).json({error:'Auftrag nicht gefunden.'});}
      if(Number(job.fahrer_id)!==Number(user.id)){db.close();return res.status(403).json({error:'Dieser Auftrag gehört nicht dir.'});}
      if(job.status!=='gestartet'){db.close();return res.status(409).json({error:'Der Auftrag kann nur aus dem Status gestartet abgeschlossen werden.'});}
      db.run("UPDATE jobs SET status='abgeschlossen' WHERE id=?",[id],err=>{db.close();if(err)return res.status(500).json({error:'Auftrag konnte nicht abgeschlossen werden.'});res.json({success:true,status:'abgeschlossen'});});
    });
  });
  app.get('/api/driver/applications',(req,res)=>{
    const user=auth(req,res,'fahrer'); if(!user) return;
    const db=dbOpen();
    db.all(`SELECT a.id,a.job_id,a.status,a.created_at,j.titel,j.beschreibung,j.preis,j.vehicle_type,j.status AS job_status,j.firma_id FROM applications a JOIN jobs j ON j.id=a.job_id WHERE a.fahrer_id=? ORDER BY a.created_at DESC`,[user.id],(e,rows)=>{db.close();if(e)return res.status(500).json({error:'Bewerbungen konnten nicht geladen werden.'});res.json(rows);});
  });
  try {
    const syncDb = new BetterSqlite3(process.env.DATABASE_PATH || './driverpool24.db');
    const cols = syncDb.prepare('PRAGMA table_info(jobs)').all();
    if (!cols.some(c=>c.name==='fahrer_id')) syncDb.exec('ALTER TABLE jobs ADD COLUMN fahrer_id INTEGER');
    syncDb.close();
  } catch(e) { console.error('workflow migration:',e); }
  return originalListen.apply(app,args);
};
