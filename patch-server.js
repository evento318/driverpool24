import fs from 'fs/promises';

const file = 'server.js';
const source = await fs.readFile(file, 'utf8');

const marker = "app.get('/api/jobs',async(req,res)=>res.json(await getJobs()));";
const loginStart = "app.post('/api/login',";
const start = source.indexOf(loginStart);
const end = source.indexOf(marker);

if (start === -1 || end === -1 || end <= start) {
  throw new Error('Login route could not be located in server.js');
}

const fixedRoutes = `app.post('/api/login',async(req,res)=>{try{const{email,password,role}=req.body;const normalizedEmail=String(email||'').trim().toLowerCase();if(!normalizedEmail||!password)return res.status(400).json({error:'Bitte E-Mail und Passwort eingeben.'});const user=await getUserByEmail(normalizedEmail);if(!user)return res.status(401).json({error:'Kein Konto mit dieser E-Mail gefunden. Bitte zuerst ein Konto erstellen.'});const ok=await bcrypt.compare(String(password),user.password);if(!ok)return res.status(401).json({error:'E-Mail oder Passwort ist falsch.'});if(role&&user.role!==role)return res.status(403).json({error:'Dieses Konto gehört zu einem anderen Bereich.'});const token=jwt.sign({id:user.id,role:user.role},JWT_SECRET,{expiresIn:'7d'});res.json({success:true,token,user:{id:user.id,name:user.name,email:user.email,role:user.role}});}catch(err){console.error(err);res.status(500).json({error:'Login fehlgeschlagen. Bitte später erneut versuchen.'});}});
app.post('/api/register',async(req,res)=>{try{const{name,email,password,role}=req.body;const normalizedEmail=String(email||'').trim().toLowerCase();const cleanName=String(name||'').trim();if(!cleanName||cleanName.length<2)return res.status(400).json({error:'Bitte einen gültigen Namen eingeben.'});if(!/^\\S+@\\S+\\.\\S+$/.test(normalizedEmail))return res.status(400).json({error:'Bitte eine gültige E-Mail-Adresse eingeben.'});if(String(password||'').length<8)return res.status(400).json({error:'Das Passwort muss mindestens 8 Zeichen haben.'});if(!['fahrer','firma'].includes(role))return res.status(400).json({error:'Ungültige Kontoart.'});const existing=await getUserByEmail(normalizedEmail);if(existing)return res.status(409).json({error:'Für diese E-Mail existiert bereits ein Konto. Bitte anmelden.'});const hash=await bcrypt.hash(String(password),10);const user=await createUser({name:cleanName,email:normalizedEmail,password:hash,role});res.status(201).json({success:true,message:'Konto wurde erstellt. Du kannst dich jetzt anmelden.',user});}catch(err){console.error(err);res.status(500).json({error:'Konto konnte nicht erstellt werden.'});}});
app.get('/api/me',authenticate,async(req,res)=>{try{const{getUserById}=await import('./database.js');const user=await getUserById(req.user.id);if(!user)return res.status(401).json({error:'Konto nicht gefunden.'});res.json({authenticated:true,user});}catch(err){console.error(err);res.status(500).json({error:'Sitzung konnte nicht geprüft werden.'});}});
`;

const next = source.slice(0, start) + fixedRoutes + source.slice(end);
await fs.writeFile(file, next, 'utf8');
console.log('DriverPool24: Login/Registrierung aktualisiert.');
`;

if (!source.includes("app.post('/api/register'")) {
  await fs.writeFile(file, next, 'utf8');
  console.log('DriverPool24: Login/Registrierung aktualisiert.');
} else {
  console.log('DriverPool24: Auth bereits aktualisiert.');
}
