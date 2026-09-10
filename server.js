const express = require('express');
const path = require('path');
const { initDatabase, getDb } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Startseite
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// -------------------- API-ENDUNKTE --------------------

// Login / Registrierung (einfach gehalten)
app.post('/api/login', async (req, res) => {
  const { email, password, role } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'E-Mail und Passwort erforderlich' });
  }

  const db = getDb();
  let user = await db.get('SELECT * FROM users WHERE email = ?', [email]);

  if (!user) {
    // Registrierung, falls nicht vorhanden
    const result = await db.run(
      'INSERT INTO users (email, password, role, name) VALUES (?, ?, ?, ?)',
      [email, password, role || 'fahrer', email]
    );
    user = { id: result.lastID, email, role: role || 'fahrer' };
  }

  res.json({ success: true, user });
});

// Jobs abrufen
app.get('/api/jobs', async (req, res) => {
  const db = getDb();
  const jobs = await db.all('SELECT * FROM jobs ORDER BY created_at DESC');
  res.json(jobs);
});

// Neuen Job erstellen
app.post('/api/jobs', async (req, res) => {
  const { firma_id, titel, beschreibung, preis } = req.body;
  const db = getDb();
  const result = await db.run(
    'INSERT INTO jobs (firma_id, titel, beschreibung, preis) VALUES (?, ?, ?, ?)',
    [firma_id, titel, beschreibung, preis]
  );
  res.json({ success: true, jobId: result.lastID });
});

// Bewerbung auf Job
app.post('/api/jobs/:id/apply', async (req, res) => {
  const { fahrer_id } = req.body;
  const db = getDb();
  await db.run(
    'INSERT INTO applications (job_id, fahrer_id) VALUES (?, ?)',
    [req.params.id, fahrer_id]
  );
  res.json({ success: true });
});

// Bewerbungen für Job abrufen
app.get('/api/jobs/:id/applications', async (req, res) => {
  const db = getDb();
  const apps = await db.all(
    `SELECT a.*, u.email, u.name FROM applications a
     JOIN users u ON a.fahrer_id = u.id
     WHERE a.job_id = ?`,
    [req.params.id]
  );
  res.json(apps);
});

// Fahrer einstellen & Rechnung erstellen
app.post('/api/jobs/:id/hire', async (req, res) => {
  const { fahrer_id, fahrerlohn, gebuehr } = req.body;
  const db = getDb();
  const job = await db.get('SELECT * FROM jobs WHERE id = ?', [req.params.id]);
  if (!job) return res.status(404).json({ error: 'Job nicht gefunden' });

  const gesamt = fahrerlohn + gebuehr;

  await db.run(
    'INSERT INTO invoices (job_id, firma_id, fahrer_id, fahrerlohn, gebuehr, gesamt) VALUES (?, ?, ?, ?, ?, ?)',
    [req.params.id, job.firma_id, fahrer_id, fahrerlohn, gebuehr, gesamt]
  );

  await db.run(
    'UPDATE applications SET status = ? WHERE job_id = ? AND fahrer_id = ?',
    ['ausgewählt', req.params.id, fahrer_id]
  );

  await db.run(
    'UPDATE jobs SET status = ? WHERE id = ?',
    ['erledigt', req.params.id]
  );

  res.json({ success: true, gesamt });
});

// Rechnungen abrufen
app.get('/api/invoices', async (req, res) => {
  const db = getDb();
  const invoices = await db.all('SELECT * FROM invoices ORDER BY created_at DESC');
  res.json(invoices);
});

// Admin-Statistiken
app.get('/api/admin/stats', async (req, res) => {
  const db = getDb();
  const stats = {
    userCount: (await db.get('SELECT COUNT(*) as c FROM users')).c,
    jobCount: (await db.get('SELECT COUNT(*) as c FROM jobs')).c,
    invoiceCount: (await db.get('SELECT COUNT(*) as c FROM invoices')).c,
    umsatz: (await db.get('SELECT SUM(gebuehr) as sum FROM invoices')).sum || 0
  };
  res.json(stats);
});

// -------------------- START --------------------

initDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`Driverpool24 läuft auf Port ${PORT}`);
  });
});
