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
  getApplicationByJobAndEmail,
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
const JWT_SECRET = process.env.JWT_SECRET || 'change_this_in_production';

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

function verifyToken(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ success: false, message: 'No token' });
  const parts = auth.split(' ');
  if (parts.length !== 2) return res.status(401).json({ success: false, message: 'Invalid auth header' });
  const token = parts[1];
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
}

// Auth: register/login
app.post('/api/login', async (req, res) => {
  try {
    const { email, password, role, name, region, plan, agbAcceptedAt } = req.body;
    if (!email || !password) return res.status(400).json({ success: false, message: 'Email and password required' });

    const existing = await getUserByEmail(email);
    if (!existing) {
      const hashed = await bcrypt.hash(password, 10);
      const result = await createUser(email, hashed, role || 'fahrer', name || email.split('@')[0], region || null, plan || 'Starter', agbAcceptedAt || null);
      const userId = result.lastID;
      const token = jwt.sign({ id: userId, email, role: role || 'fahrer' }, JWT_SECRET, { expiresIn: '7d' });
      return res.json({ success: true, token, user: { id: userId, email, name: name || email.split('@')[0], role: role || 'fahrer' } });
    }

    // login path
    const valid = await bcrypt.compare(password, existing.password);
    if (!valid) return res.status(401).json({ success: false, message: 'Invalid credentials' });

    const token = jwt.sign({ id: existing.id, email: existing.email, role: existing.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, token, user: { id: existing.id, email: existing.email, name: existing.name, role: existing.role } });
  } catch (err) {
    console.error('Login error', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.post('/api/logout', (req, res) => {
  // stateless JWT: client just discards token
  res.json({ success: true });
});

// Jobs
app.get('/api/jobs', async (req, res) => {
  const { role, region, posted_by } = req.query;
  try {
    const list = await getJobs(role || null, region || null, posted_by || null);
    res.json(list);
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: 'DB error' });
  }
});

app.post('/api/jobs', verifyToken, async (req, res) => {
  try {
    const { from_loc, to_loc, region, date, cargo, drivers_needed, pay, req: requirements, posted_by, plan } = req.body;
    const r = await createJob(from_loc, to_loc, region, date, cargo, parseInt(drivers_needed || 1), parseFloat(pay || 0), requirements || null, posted_by || req.user.email, plan || null);
    res.json({ success: true, jobId: r.lastID });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: 'Could not create job' });
  }
});

app.get('/api/jobs/:id', async (req, res) => {
  try {
    const job = await getJobById(req.params.id);
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });
    res.json(job);
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: 'DB error' });
  }
});

// Applications
app.post('/api/jobs/:id/apply', async (req, res) => {
  try {
    const job_id = parseInt(req.params.id);
    const { driver_name, driver_email } = req.body;
    if (!driver_name || !driver_email) return res.status(400).json({ success: false, message: 'Missing fields' });

    const existing = await getApplicationByJobAndEmail(job_id, driver_email);
    if (existing) return res.status(400).json({ success: false, message: 'Already applied' });

    const r = await createApplication(job_id, driver_name, driver_email);
    res.json({ success: true, applicationId: r.lastID });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: 'DB error' });
  }
});

app.get('/api/jobs/:id/applications', async (req, res) => {
  try {
    const apps = await getApplicationsByJobId(parseInt(req.params.id));
    res.json(apps);
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: 'DB error' });
  }
});

// Hire
app.post('/api/jobs/:id/hire', verifyToken, async (req, res) => {
  try {
    const job_id = parseInt(req.params.id);
    const { application_id, fahrerlohn, gebuehr } = req.body;

    const application = await getApplicationById(application_id);
    const job = await getJobById(job_id);
    if (!job || !application) return res.status(404).json({ success: false, message: 'Job or application not found' });

    // create invoice
    const invoice_number = `INV-${Date.now()}`;
    const route = `${job.from_loc} ➔ ${job.to_loc}`;
    const date = new Date().toLocaleDateString('de-DE');
    const driver_pay = parseFloat(fahrerlohn) || parseFloat(job.pay) || 0;
    const platform_fee = parseFloat(gebuehr) || 150;
    const total = driver_pay + platform_fee;

    await createInvoice(invoice_number, job_id, route, date, application.driver_name, application.driver_email, driver_pay, platform_fee, total, job.posted_by, req.user.email, new Date().toISOString());

    await updateApplicationStatus(application_id, 'ausgewählt');
    await updateJobStatus(job_id, 'erledigt', (job.drivers_hired || 0) + 1);

    res.json({ success: true, total });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: 'DB error' });
  }
});

// Invoices
app.get('/api/invoices', async (req, res) => {
  try {
    const { posted_by } = req.query;
    const list = await getInvoices(posted_by || null);
    res.json(list);
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: 'DB error' });
  }
});

app.get('/api/invoices/:id', async (req, res) => {
  try {
    const inv = await getInvoiceById(parseInt(req.params.id));
    if (!inv) return res.status(404).json({ success: false, message: 'Invoice not found' });
    res.json(inv);
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: 'DB error' });
  }
});

// Admin
app.get('/api/admin/stats', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Admin required' });
    const stats = await getAdminStats();
    res.json(stats);
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: 'DB error' });
  }
});

app.get('/api/admin/jobs', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Admin required' });
    const list = await getJobs();
    res.json(list);
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: 'DB error' });
  }
});

app.get('/api/admin/invoices', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Admin required' });
    const list = await getInvoices();
    res.json(list);
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: 'DB error' });
  }
});

// static
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start
initDatabase()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`✅ DriverPool24 Server läuft auf http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('DB init failed', err);
    process.exit(1);
  });
