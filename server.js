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
  getApplicationById,
  selectDriverForJob,
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

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Anmeldung erforderlich' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Sitzung abgelaufen. Bitte erneut anmelden.' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Keine Berechtigung' });
    next();
  };
}

app.post('/api/login', async (req, res) => {
  try {
    const { email, password, role, name } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email und Passwort nötig' });
    let user = await getUserByEmail(email);
    if (!user) {
      const hash = await bcrypt.hash(password, 10);
      user = await createUser({ name: name || email, email, password: hash, role: role || 'fahrer' });
    } else {
      const ok = await bcrypt.compare(password, user.password);
      if (!ok) return res.status(401).json({ error: 'Falsches Passwort' });
      if (role && user.role !== role) return res.status(403).json({ error: 'Dieses Konto gehört zu einem anderen Bereich.' });
    }
    const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login fehlgeschlagen' });
  }
});

app.get('/api/jobs', async (req, res) => res.json(await getJobs()));

app.post('/api/jobs', authenticate, requireRole('firma'), async (req, res) => {
  try {
    const { titel, beschreibung, preis } = req.body;
    if (!titel || !titel.trim()) return res.status(400).json({ error: 'Bitte einen Jobtitel eingeben.' });
    const job = await createJob({
      firma_id: req.user.id,
      titel: titel.trim(),
      beschreibung: beschreibung?.trim() || '',
      preis: preis === '' || preis == null ? null : Number(preis)
    });
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

app.post('/api/jobs/:id/apply', authenticate, requireRole('fahrer'), async (req, res) => {
  try {
    const job = await getJobById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job nicht gefunden' });
    if (job.status !== 'offen') return res.status(409).json({ error: 'Dieser Job ist nicht mehr offen.' });
    const application = await createApplication({ job_id: job.id, fahrer_id: req.user.id });
    res.json({ success: true, application });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Bewerbung fehlgeschlagen' });
  }
});

app.get('/api/jobs/:id/applications', authenticate, requireRole('firma'), async (req, res) => {
  const job = await getJobById(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job nicht gefunden' });
  if (job.firma_id !== req.user.id) return res.status(403).json({ error: 'Keine Berechtigung für diesen Job.' });
  res.json(await getApplicationsByJobId(req.params.id));
});

// Unternehmen wählt einen konkreten Bewerber aus.
// Die Auswahl reserviert den Job (Status: vergeben), erzeugt aber noch keine Rechnung.
app.post('/api/jobs/:id/select-driver', authenticate, requireRole('firma'), async (req, res) => {
  try {
    const fahrerId = Number(req.body.fahrer_id);
    if (!Number.isInteger(fahrerId) || fahrerId <= 0) {
      return res.status(400).json({ error: 'Ungültiger Fahrer.' });
    }

    const job = await getJobById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job nicht gefunden' });
    if (Number(job.firma_id) !== Number(req.user.id)) {
      return res.status(403).json({ error: 'Keine Berechtigung für diesen Job.' });
    }
    if (job.status !== 'offen') {
      return res.status(409).json({ error: 'Dieser Job ist bereits vergeben oder nicht mehr offen.' });
    }

    const application = await getApplicationsByJobId(job.id);
    const candidate = application.find(a => Number(a.fahrer_id) === fahrerId);
    if (!candidate) return res.status(404).json({ error: 'Dieser Fahrer hat sich nicht auf den Job beworben.' });
    if (candidate.status !== 'offen') return res.status(409).json({ error: 'Diese Bewerbung ist nicht mehr offen.' });

    const selected = await selectDriverForJob({ job_id: job.id, fahrer_id: fahrerId });
    res.json({
      success: true,
      message: 'Fahrer wurde ausgewählt. Der nächste Schritt ist die Zahlung/Reservierung.',
      job: { id: job.id, status: 'vergeben' },
      application: selected
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Fahrer konnte nicht ausgewählt werden' });
  }
});

// Legacy endpoint bleibt vorerst erhalten, wird aber nicht mehr für die Auswahl im Frontend verwendet.
app.post('/api/jobs/:id/hire', authenticate, requireRole('firma'), async (req, res) => {
  try {
    const { fahrer_id, fahrerlohn = 250, gebuehr = 150 } = req.body;
    const job = await getJobById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job nicht gefunden' });
    if (job.firma_id !== req.user.id) return res.status(403).json({ error: 'Keine Berechtigung für diesen Job.' });
    const application = await getApplicationById(fahrer_id);
    if (!application) return res.status(404).json({ error: 'Bewerbung nicht gefunden.' });
    const invoice = await createInvoice({ job_id: job.id, firma_id: job.firma_id, fahrer_id, fahrerlohn, gebuehr });
    res.json({ success: true, invoice });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Einstellung fehlgeschlagen' });
  }
});

app.get('/api/invoices', authenticate, async (req, res) => res.json(await getInvoices()));
app.get('/api/invoices/:id', authenticate, async (req, res) => {
  const invoice = await getInvoiceById(req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Rechnung nicht gefunden' });
  res.json(invoice);
});

app.get('/api/admin/stats', authenticate, requireRole('admin'), async (req, res) => res.json(await getAdminStats()));

initDatabase().then(() => {
  app.listen(PORT, () => console.log(`Driverpool24 läuft auf Port ${PORT}`));
}).catch(err => {
  console.error('DB init failed', err);
  process.exit(1);
});
