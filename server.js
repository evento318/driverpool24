import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  initDatabase,
  createUser,
  getUserByEmail,
  createJob,
  getJobs,
  getJobById,
  createApplication,
  getApplicationsByJobId,
  updateApplicationStatus,
  updateJobStatus,
  createInvoice,
  getInvoices,
  getInvoiceById,
  getAdminStats
} from './database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ---------- AUTH ----------
app.post('/api/login', async (req, res) => {
  try {
    const { email, password, role, name } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email und Passwort nötig' });

    let user = await getUserByEmail(email);
    if (!user) {
      const hash = await bcrypt.hash(password, 10);
      user = await createUser({
        name: name || email,
        email,
        password: hash,
        role: role || 'fahrer'
      });
    } else {
      const ok = await bcrypt.compare(password, user.password);
      if (!ok) return res.status(401).json({ error: 'Falsches Passwort' });
    }

    const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, token, user: { id: user.id, email: user.email, role: user.role } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login fehlgeschlagen' });
  }
});

// ---------- JOBS ----------
app.get('/api/jobs', async (req, res) => {
  const jobs = await getJobs();
  res.json(jobs);
});

app.post('/api/jobs', async (req, res) => {
  try {
    const { firma_id, titel, beschreibung, preis } = req.body;
    const job = await createJob({ firma_id, titel, beschreibung, preis });
    res.json({ success: true, job });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Job konnte nicht erstellt werden' });
  }
});

app.get('/api/jobs/:id', async (req, res) => {
  const job = await getJobById(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job nicht gefunden' });
  res.json(job);
});

// ---------- APPLICATIONS ----------
app.post('/api/jobs/:id/apply', async (req, res) => {
  try {
    const { fahrer_id } = req.body;
    const app_ = await createApplication({ job_id: req.params.id, fahrer_id });
    res.json({ success: true, application: app_ });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Bewerbung fehlgeschlagen' });
  }
});

app.get('/api/jobs/:id/applications', async (req, res) => {
  const apps = await getApplicationsByJobId(req.params.id);
  res.json(apps);
});

// ---------- HIRE & INVOICE ----------
app.post('/api/jobs/:id/hire', async (req, res) => {
  try {
    const { fahrer_id, fahrerlohn = 250, gebuehr = 150 } = req.body;
    const job = await getJobById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job nicht gefunden' });

    const invoice = await createInvoice({
      job_id: job.id,
      firma_id: job.firma_id,
      fahrer_id,
      fahrerlohn,
      gebuehr
    });

    await updateJobStatus(job.id, 'erledigt');
    res.json({ success: true, invoice });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Einstellung fehlgeschlagen' });
  }
});

// ---------- INVOICES ----------
app.get('/api/invoices', async (req, res) => {
  const invoices = await getInvoices();
  res.json(invoices);
});

app.get('/api/invoices/:id', async (req, res) => {
  const invoice = await getInvoiceById(req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Rechnung nicht gefunden' });
  res.json(invoice);
});

// ---------- ADMIN ----------
app.get('/api/admin/stats', async (req, res) => {
  const stats = await getAdminStats();
  res.json(stats);
});

// ---------- START ----------
initDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`Driverpool24 läuft auf Port ${PORT}`);
  });
}).catch(err => {
  console.error('DB init failed', err);
  process.exit(1);
});
