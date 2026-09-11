import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import multer from 'multer';
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
  getAdminStats,
  createDriverDocument,
  getDriverDocuments,
  getDriverDocumentById,
  verifyDriverDocument,
  deleteDriverDocument
} from './database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const DOCUMENTS_PATH = process.env.DOCUMENTS_PATH || path.join(__dirname, 'private-documents');
const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024;

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

const upload = multer({
  storage: multer.diskStorage({
    destination: async (req, file, cb) => {
      try {
        await fs.mkdir(DOCUMENTS_PATH, { recursive: true });
        cb(null, DOCUMENTS_PATH);
      } catch (err) { cb(err); }
    },
    filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(18).toString('hex')}`)
  }),
  limits: { fileSize: MAX_DOCUMENT_SIZE, files: 1 },
  fileFilter: (req, file, cb) => {
    const allowed = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
    if (!allowed.has(file.mimetype)) return cb(new Error('Nur PDF, JPG, PNG oder WebP sind erlaubt.'));
    cb(null, true);
  }
});

async function validateDocumentFile(file) {
  const handle = await fs.open(file.path, 'r');
  const buffer = Buffer.alloc(12);
  try {
    await handle.read(buffer, 0, 12, 0);
  } finally {
    await handle.close();
  }
  const isPdf = buffer.subarray(0, 5).toString() === '%PDF-';
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isPng = buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const isWebp = buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP';
  return (isPdf && file.mimetype === 'application/pdf') ||
         (isJpeg && file.mimetype === 'image/jpeg') ||
         (isPng && file.mimetype === 'image/png') ||
         (isWebp && file.mimetype === 'image/webp');
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

app.post('/api/jobs/:id/select-driver', authenticate, requireRole('firma'), async (req, res) => {
  try {
    const fahrerId = Number(req.body.fahrer_id);
    if (!Number.isInteger(fahrerId) || fahrerId <= 0) return res.status(400).json({ error: 'Ungültiger Fahrer.' });
    const job = await getJobById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job nicht gefunden' });
    if (Number(job.firma_id) !== Number(req.user.id)) return res.status(403).json({ error: 'Keine Berechtigung für diesen Job.' });
    if (job.status !== 'offen') return res.status(409).json({ error: 'Dieser Job ist bereits vergeben oder nicht mehr offen.' });
    const applications = await getApplicationsByJobId(job.id);
    const candidate = applications.find(a => Number(a.fahrer_id) === fahrerId);
    if (!candidate) return res.status(404).json({ error: 'Dieser Fahrer hat sich nicht auf den Job beworben.' });
    if (candidate.status !== 'offen') return res.status(409).json({ error: 'Diese Bewerbung ist nicht mehr offen.' });
    const selected = await selectDriverForJob({ job_id: job.id, fahrer_id: fahrerId });
    res.json({ success: true, message: 'Fahrer wurde ausgewählt. Der nächste Schritt ist die Zahlung/Reservierung.', job: { id: job.id, status: 'reserviert' }, application: selected });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Fahrer konnte nicht ausgewählt werden' });
  }
});

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

// Private driver documents: never expose this directory through express.static.
app.get('/api/driver/documents', authenticate, requireRole('fahrer'), async (req, res) => {
  res.json(await getDriverDocuments(req.user.id));
});

app.post('/api/driver/documents', authenticate, requireRole('fahrer'), (req, res) => {
  upload.single('document')(req, res, async err => {
    if (err) return res.status(400).json({ error: err.message || 'Dokument konnte nicht hochgeladen werden.' });
    if (!req.file) return res.status(400).json({ error: 'Bitte ein Dokument auswählen.' });
    const { document_type, issued_at, expires_at } = req.body;
    const allowedTypes = new Set(['a1', 'personalausweis', 'reisepass', 'fuehrerschein', 'fahrerkarte', 'lkw_modul', 'sonstiges']);
    try {
      if (!allowedTypes.has(document_type)) throw new Error('Ungültiger Dokumenttyp.');
      const validFile = await validateDocumentFile(req.file);
      if (!validFile) throw new Error('Die Datei entspricht nicht dem erkannten Dateiformat.');
      const document = await createDriverDocument({
        fahrer_id: req.user.id,
        document_type,
        original_name: req.file.originalname,
        stored_name: req.file.filename,
        mime_type: req.file.mimetype,
        file_size: req.file.size,
        issued_at: issued_at || null,
        expires_at: expires_at || null,
        auto_status: 'geprueft'
      });
      res.json({ success: true, message: 'Automatische Dateikontrolle bestanden. Admin-Prüfung ausstehend.', document });
    } catch (error) {
      await fs.unlink(req.file.path).catch(() => {});
      console.error(error);
      res.status(400).json({ error: error.message || 'Dokument konnte nicht gespeichert werden.' });
    }
  });
});

app.get('/api/driver/documents/:id/file', authenticate, async (req, res) => {
  const document = await getDriverDocumentById(req.params.id);
  if (!document) return res.status(404).json({ error: 'Dokument nicht gefunden.' });
  if (req.user.role !== 'admin' && Number(document.fahrer_id) !== Number(req.user.id)) return res.status(403).json({ error: 'Keine Berechtigung.' });
  try {
    await fs.access(path.join(DOCUMENTS_PATH, document.stored_name));
    res.type(document.mime_type);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(document.original_name)}"`);
    res.sendFile(document.stored_name, { root: DOCUMENTS_PATH });
  } catch {
    res.status(404).json({ error: 'Datei nicht verfügbar.' });
  }
});

app.get('/api/admin/documents', authenticate, requireRole('admin'), async (req, res) => {
  const stats = await getAdminStats();
  res.json({ pendingDocuments: stats.pendingDocuments });
});

app.post('/api/admin/documents/:id/verify', authenticate, requireRole('admin'), async (req, res) => {
  const status = String(req.body.status || '');
  if (!['geprueft', 'abgelehnt'].includes(status)) return res.status(400).json({ error: 'Ungültiger Prüfstatus.' });
  const document = await getDriverDocumentById(req.params.id);
  if (!document) return res.status(404).json({ error: 'Dokument nicht gefunden.' });
  await verifyDriverDocument(document.id, req.user.id, status, String(req.body.note || '').slice(0, 1000));
  res.json({ success: true, message: status === 'geprueft' ? 'Dokument freigegeben.' : 'Dokument abgelehnt.' });
});

app.get('/api/admin/stats', authenticate, requireRole('admin'), async (req, res) => res.json(await getAdminStats()));

initDatabase().then(async () => {
  await fs.mkdir(DOCUMENTS_PATH, { recursive: true });
  app.listen(PORT, () => console.log(`Driverpool24 läuft auf Port ${PORT}`));
}).catch(err => {
  console.error('DB init failed', err);
  process.exit(1);
});
