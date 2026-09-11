import fs from 'fs';

const file = 'server.js';
let s = fs.readFileSync(file, 'utf8');

const oldSecret = "const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';";
const newSecret = "const JWT_SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? (() => { throw new Error('JWT_SECRET muss in Produktion gesetzt sein.'); })() : 'dev-secret');";
if (s.includes(oldSecret)) s = s.replace(oldSecret, newSecret);

const oldJobs = "app.get('/api/jobs',async(req,res)=>res.json(await getJobs()));";
const newJobs = "app.get('/api/jobs',authenticate,async(req,res)=>{try{const jobs=await getJobs();if(req.user.role==='admin')return res.json(jobs);if(req.user.role==='firma')return res.json(jobs.filter(job=>Number(job.firma_id)===Number(req.user.id)));if(req.user.role==='fahrer')return res.json(jobs.filter(job=>job.status==='offen'||Number(job.fahrer_id)===Number(req.user.id)));return res.status(403).json({error:'Keine Berechtigung'});}catch(err){console.error(err);res.status(500).json({error:'Aufträge konnten nicht geladen werden.'});}});";
if (!s.includes(newJobs)) {
  if (!s.includes(oldJobs)) throw new Error('GET /api/jobs route not found');
  s = s.replace(oldJobs, newJobs);
}

const oldJobById = "app.get('/api/jobs/:id',async(req,res)=>{const job=await getJobById(req.params.id);if(!job)return res.status(404).json({error:'Job nicht gefunden'});res.json(job);});";
const newJobById = "app.get('/api/jobs/:id',authenticate,async(req,res)=>{const job=await getJobById(req.params.id);if(!job)return res.status(404).json({error:'Job nicht gefunden'});if(req.user.role==='admin')return res.json(job);if(req.user.role==='firma'&&Number(job.firma_id)!==Number(req.user.id))return res.status(403).json({error:'Keine Berechtigung für diesen Job.'});if(req.user.role==='fahrer'&&job.status!=='offen'&&Number(job.fahrer_id)!==Number(req.user.id))return res.status(403).json({error:'Keine Berechtigung für diesen Job.'});res.json(job);});";
if (!s.includes(newJobById)) {
  if (!s.includes(oldJobById)) throw new Error('GET /api/jobs/:id route not found');
  s = s.replace(oldJobById, newJobById);
}

fs.writeFileSync(file, s);
console.log('Security patch applied.');
