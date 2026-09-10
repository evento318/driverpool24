import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Simple in-memory database (replace with SQLite later)
let users = [];
let jobs = [];
let applications = [];
let invoices = [];

// Helper functions
function generateId() {
  return Math.floor(Math.random() * 1000000);
}

function findUser(email) {
  return users.find(u => u.email === email);
}

function findJob(id) {
  return jobs.find(j => j.id === id);
}

function verifyToken(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'No token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    res.status(401).json({ success: false, message: 'Invalid token' });
  }
}

// === AUTH ENDPOINTS ===

app.post('/api/login', async (req, res) => {
  const { email, password, role, name, region, plan, agbAcceptedAt } = req.body;

  if (!email || !password) {
    return res.json({ success: false, message: 'Email und Passwort erforderlich' });
  }

  let user = findUser(email);

  if (!user) {
    // Registrierung: neuer Benutzer
    const hashedPassword = await bcrypt.hash(password, 10);
    user = {
      id: generateId(),
      email,
      password: hashedPassword,
      role: role || 'fahrer',
      name: name || email.split('@')[0],
      region: region || null,
      plan: plan || 'Starter',
      agbAcceptedAt: agbAcceptedAt || null,
      createdAt: new Date().toISOString()
    };
    users.push(user);
  } else {
    // Login: Passwort überprüfen
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return res.json({ success: false, message: 'Passwort falsch' });
    }
  }

  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.json({
    success: true,
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      region: user.region,
      plan: user.plan,
      agbAcceptedAt: user.agbAcceptedAt
    }
  });
});

app.post('/api/logout', (req, res) => {
  res.json({ success: true, message: 'Logged out' });
});

// === JOBS ENDPOINTS ===

app.get('/api/jobs', (req, res) => {
  const { role, region, name } = req.query;
  let filtered = jobs;

  if (role === 'fahrer' && region) {
    filtered = filtered.filter(j => j.region === region);
  } else if (role === 'firma' && name) {
    filtered = filtered.filter(j => j.posted_by === name);
  }

  res.json(filtered);
});

app.post('/api/jobs', verifyToken, (req, res) => {
  const { from_loc, to_loc, region, date, cargo, drivers_needed, pay, req: requirements, posted_by, plan } = req.body;

  const job = {
    id: generateId(),
    from_loc,
    to_loc,
    region,
    date,
    cargo,
    drivers_needed: parseInt(drivers_needed),
    pay: parseFloat(pay),
    req: requirements,
    posted_by,
    plan,
    status: 'open',
    drivers_hired: 0,
    createdAt: new Date().toISOString()
  };

  jobs.push(job);
  res.json({ success: true, job });
});

app.get('/api/jobs/:id', (req, res) => {
  const job = findJob(parseInt(req.params.id));
  if (!job) return res.status(404).json({ success: false, message: 'Job nicht gefunden' });
  res.json(job);
});

// === APPLICATIONS ENDPOINTS ===

app.post('/api/jobs/:id/apply', verifyToken, (req, res) => {
  const jobId = parseInt(req.params.id);
  const { driver_name, driver_email } = req.body;
  const job = findJob(jobId);

  if (!job) return res.status(404).json({ success: false, message: 'Job nicht gefunden' });

  const existing = applications.find(a => a.job_id === jobId && a.driver_email === driver_email);
  if (existing) {
    return res.json({ success: false, message: 'Du hast dich bereits beworben' });
  }

  const application = {
    id: generateId(),
    job_id: jobId,
    driver_name,
    driver_email,
    status: 'pending',
    createdAt: new Date().toISOString()
  };

  applications.push(application);
  res.json({ success: true, application });
});

app.get('/api/jobs/:id/applications', (req, res) => {
  const jobId = parseInt(req.params.id);
  const jobApps = applications.filter(a => a.job_id === jobId);
  res.json(jobApps);
});

// === HIRE & PAY ENDPOINTS ===

app.post('/api/jobs/:id/hire', verifyToken, (req, res) => {
  const { application_id, payer_name, amount } = req.body;
  const jobId = parseInt(req.params.id);
  const job = findJob(jobId);
  const application = applications.find(a => a.id === application_id);

  if (!job || !application) {
    return res.status(404).json({ success: false, message: 'Job oder Bewerbung nicht gefunden' });
  }

  application.status = 'hired';
  job.drivers_hired += 1;

  if (job.drivers_hired >= job.drivers_needed) {
    job.status = 'closed';
  }

  const invoice = {
    id: generateId(),
    invoice_number: `INV-${Date.now()}`,
    job_id: jobId,
    route: `${job.from_loc} ➔ ${job.to_loc}`,
    date: new Date().toLocaleDateString('de-DE'),
    driver_name: application.driver_name,
    driver_email: application.driver_email,
    driver_pay: parseFloat(job.pay),
    platform_fee: 150,
    total: parseFloat(job.pay) + 150,
    posted_by: job.posted_by,
    payer_name,
    paid_at: new Date().toISOString(),
    status: 'paid'
  };

  invoices.push(invoice);

  res.json({
    success: true,
    message: 'Fahrer eingestellt und bezahlt',
    invoice
  });
});

// === INVOICES ENDPOINTS ===

app.get('/api/invoices', (req, res) => {
  const { posted_by } = req.query;
  let filtered = invoices;

  if (posted_by) {
    filtered = filtered.filter(i => i.posted_by === posted_by);
  }

  res.json(filtered);
});

app.get('/api/invoices/:id', (req, res) => {
  const invoice = invoices.find(i => i.id === parseInt(req.params.id));
  if (!invoice) return res.status(404).json({ success: false, message: 'Rechnung nicht gefunden' });
  res.json(invoice);
});

// === ADMIN ENDPOINTS ===

app.get('/api/admin/stats', verifyToken, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Admin-Zugriff erforderlich' });
  }

  const totalOrders = jobs.length;
  const openOrders = jobs.filter(j => j.status === 'open').length;
  const closedOrders = jobs.filter(j => j.status === 'closed').length;
  const totalRevenue = invoices.reduce((sum, i) => sum + 150, 0); // Platform fees
  const paidInvoices = invoices.filter(i => i.status === 'paid').length;

  res.json({
    totalOrders,
    openOrders,
    closedOrders,
    totalRevenue,
    paidInvoices
  });
});

app.get('/api/admin/jobs', verifyToken, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Admin-Zugriff erforderlich' });
  }
  res.json(jobs);
});

app.get('/api/admin/invoices', verifyToken, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Admin-Zugriff erforderlich' });
  }
  res.json(invoices);
});

// === STATIC FILES ===

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ DriverPool24 Server läuft auf http://localhost:${PORT}`);
  console.log(`📊 ${users.length} Benutzer, ${jobs.length} Jobs, ${invoices.length} Rechnungen`);
});