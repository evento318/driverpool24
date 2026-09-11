import fs from 'fs';

const dbFile='database.js';
let db=fs.readFileSync(dbFile,'utf8');
if(!db.includes('admin_module_permissions')){
  const marker="        CREATE TABLE IF NOT EXISTS conversations";
  const insert="        CREATE TABLE IF NOT EXISTS admin_module_permissions (area TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);\n        INSERT OR IGNORE INTO admin_module_permissions (area,enabled) VALUES ('jobs',1),('drivers',1),('companies',1),('sos',1),('billing',1);\n";
  if(!db.includes(marker)) throw new Error('database insertion marker not found');
  db=db.replace(marker,insert+marker);
}
if(!db.includes('export async function getAdminModulePermissions')){
  const marker="export async function createUser({ name, email, password, role })";
  const funcs="export async function getAdminModulePermissions() { return await db.all(\"SELECT area,enabled,updated_at FROM admin_module_permissions ORDER BY CASE area WHEN 'jobs' THEN 1 WHEN 'drivers' THEN 2 WHEN 'companies' THEN 3 WHEN 'sos' THEN 4 WHEN 'billing' THEN 5 ELSE 99 END\"); }\nexport async function isAdminModuleEnabled(area) { const row=await db.get('SELECT enabled FROM admin_module_permissions WHERE area=?',[area]); return row ? Number(row.enabled)===1 : true; }\nexport async function setAdminModulePermission(area,enabled) { const allowed=new Set(['jobs','drivers','companies','sos','billing']); if(!allowed.has(area)) throw new Error('Ungültiger Bereich.'); await db.run('INSERT INTO admin_module_permissions(area,enabled,updated_at) VALUES(?,?,CURRENT_TIMESTAMP) ON CONFLICT(area) DO UPDATE SET enabled=excluded.enabled,updated_at=CURRENT_TIMESTAMP',[area,enabled?1:0]); return await db.get('SELECT area,enabled,updated_at FROM admin_module_permissions WHERE area=?',[area]); }\n\n";
  if(!db.includes(marker)) throw new Error('database function marker not found');
  db=db.replace(marker,funcs+marker);
}
fs.writeFileSync(dbFile,db);

const file='server.js';
let s=fs.readFileSync(file,'utf8');
const oldImport="getUserLanguage, setUserLanguage, createConversation, userIsConversationParticipant, getConversationsForUser, getConversationMessages, createMessage }";
const newImport="getUserLanguage, setUserLanguage, createConversation, userIsConversationParticipant, getConversationsForUser, getConversationMessages, createMessage, getAdminModulePermissions, isAdminModuleEnabled, setAdminModulePermission }";
if(s.includes(oldImport)) s=s.replace(oldImport,newImport);
else if(!s.includes(newImport)) throw new Error('server import marker not found');

const oldAuth="function authenticate(req,res,next){const header=req.headers.authorization||'';const token=header.startsWith('Bearer ')?header.slice(7):null;if(!token)return res.status(401).json({error:'Anmeldung erforderlich'});try{req.user=jwt.verify(token,JWT_SECRET);next();}catch{return res.status(401).json({error:'Sitzung abgelaufen. Bitte erneut anmelden.'});}}";
const newAuth="async function authenticate(req,res,next){const header=req.headers.authorization||'';const token=header.startsWith('Bearer ')?header.slice(7):null;if(!token)return res.status(401).json({error:'Anmeldung erforderlich'});try{req.user=jwt.verify(token,JWT_SECRET);const p=req.path||'';let area=null;if(p.startsWith('/api/jobs/')&&p.includes('/sos')) area='sos';else if(p.startsWith('/api/jobs')) area='jobs';else if(p.startsWith('/api/invoices')) area='billing';else if(p.startsWith('/api/driver/sos')) area='sos';else if(p.startsWith('/api/driver')||p.startsWith('/api/documents')||p.startsWith('/api/ratings')) area='drivers';if(area&&req.user.role!=='admin'){const enabled=await isAdminModuleEnabled(area);if(!enabled)return res.status(403).json({error:'Dieser Bereich wurde vom Admin vorübergehend gesperrt.'});}next();}catch(err){console.error(err);return res.status(401).json({error:'Sitzung abgelaufen. Bitte erneut anmelden.'});}}";
if(s.includes(oldAuth)) s=s.replace(oldAuth,newAuth); else if(!s.includes(newAuth)) throw new Error('authenticate marker not found');

const marker="app.get('/api/me',authenticate,async(req,res)=>";
const routes="app.get('/api/admin/permissions',authenticate,requireRole('admin'),async(req,res)=>{try{res.json({areas:await getAdminModulePermissions()});}catch(err){console.error(err);res.status(500).json({error:'Berechtigungen konnten nicht geladen werden.'});}});\napp.put('/api/admin/permissions/:area',authenticate,requireRole('admin'),async(req,res)=>{try{const enabled=Boolean(req.body?.enabled);const area=String(req.params.area||'').toLowerCase();const permission=await setAdminModulePermission(area,enabled);res.json({success:true,permission});}catch(err){res.status(400).json({error:err.message||'Berechtigung konnte nicht geändert werden.'});}});\n\n";
if(!s.includes("app.get('/api/admin/permissions'")){
  if(!s.includes(marker)) throw new Error('admin route insertion marker not found');
  s=s.replace(marker,routes+marker);
}
fs.writeFileSync(file,s);
console.log('Admin module permissions patch applied.');
