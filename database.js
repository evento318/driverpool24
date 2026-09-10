import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

let db;

export async function initDatabase() {
    db = await open({
        filename: process.env.DATABASE_PATH || './driverpool24.db',
        driver: sqlite3.Database
    });

    await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('fahrer','firma','admin')),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            firma_id INTEGER NOT NULL,
            titel TEXT NOT NULL,
            beschreibung TEXT,
            preis REAL,
            status TEXT DEFAULT 'offen',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (firma_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS applications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id INTEGER NOT NULL,
            fahrer_id INTEGER NOT NULL,
            status TEXT DEFAULT 'offen',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (job_id) REFERENCES jobs(id),
            FOREIGN KEY (fahrer_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS invoices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id INTEGER NOT NULL,
            firma_id INTEGER NOT NULL,
            fahrer_id INTEGER NOT NULL,
            fahrerlohn REAL NOT NULL,
            gebuehr REAL NOT NULL,
            gesamt REAL NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (job_id) REFERENCES jobs(id),
            FOREIGN KEY (firma_id) REFERENCES users(id),
            FOREIGN KEY (fahrer_id) REFERENCES users(id)
        );
    `);

    console.log('✅ Datenbank initialisiert');
}

export async function createUser({ name, email, password, role }) {
    const result = await db.run(
        'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
        [name, email, password, role]
    );
    return { id: result.lastID, name, email, role };
}

export async function getUserByEmail(email) {
    return await db.get('SELECT * FROM users WHERE email = ?', [email]);
}

export async function createJob({ firma_id, titel, beschreibung, preis }) {
    const result = await db.run(
        'INSERT INTO jobs (firma_id, titel, beschreibung, preis) VALUES (?, ?, ?, ?)',
        [firma_id, titel, beschreibung, preis]
    );
    return { id: result.lastID, firma_id, titel, beschreibung, preis, status: 'offen' };
}

export async function getJobs() {
    return await db.all('SELECT * FROM jobs ORDER BY created_at DESC');
}

export async function getJobById(id) {
    return await db.get('SELECT * FROM jobs WHERE id = ?', [id]);
}

export async function updateJobStatus(id, status) {
    return await db.run('UPDATE jobs SET status = ? WHERE id = ?', [status, id]);
}

export async function createApplication({ job_id, fahrer_id }) {
    const existing = await db.get(
        'SELECT * FROM applications WHERE job_id = ? AND fahrer_id = ?',
        [job_id, fahrer_id]
    );
    if (existing) return existing;

    const result = await db.run(
        'INSERT INTO applications (job_id, fahrer_id) VALUES (?, ?)',
        [job_id, fahrer_id]
    );
    return { id: result.lastID, job_id, fahrer_id, status: 'offen' };
}

export async function getApplicationsByJobId(job_id) {
    return await db.all(
        `SELECT a.*, u.name AS fahrer_name, u.email AS fahrer_email
         FROM applications a
         JOIN users u ON a.fahrer_id = u.id
         WHERE a.job_id = ?
         ORDER BY a.created_at ASC`,
        [job_id]
    );
}

export async function getApplicationByJobAndEmail(job_id, email) {
    return await db.get(
        `SELECT a.* FROM applications a
         JOIN users u ON a.fahrer_id = u.id
         WHERE a.job_id = ? AND u.email = ?`,
        [job_id, email]
    );
}

export async function getApplicationById(id) {
    return await db.get('SELECT * FROM applications WHERE id = ?', [id]);
}

export async function updateApplicationStatus(id, status) {
    return await db.run('UPDATE applications SET status = ? WHERE id = ?', [status, id]);
}

export async function selectDriverForJob({ job_id, fahrer_id }) {
    const application = await db.get(
        'SELECT * FROM applications WHERE job_id = ? AND fahrer_id = ?',
        [job_id, fahrer_id]
    );
    if (!application) return null;

    await db.run('BEGIN TRANSACTION');
    try {
        await db.run(
            `UPDATE applications
             SET status = CASE WHEN fahrer_id = ? THEN 'angenommen' ELSE 'abgelehnt' END
             WHERE job_id = ?`,
            [fahrer_id, job_id]
        );
        await db.run('UPDATE jobs SET status = ? WHERE id = ?', ['vergeben', job_id]);
        await db.run('COMMIT');
    } catch (err) {
        await db.run('ROLLBACK');
        throw err;
    }

    return await db.get(
        `SELECT a.*, u.name AS fahrer_name, u.email AS fahrer_email
         FROM applications a JOIN users u ON a.fahrer_id = u.id
         WHERE a.job_id = ? AND a.fahrer_id = ?`,
        [job_id, fahrer_id]
    );
}

export async function createInvoice({ job_id, firma_id, fahrer_id, fahrerlohn, gebuehr }) {
    const gesamt = fahrerlohn + gebuehr;
    const result = await db.run(
        `INSERT INTO invoices (job_id, firma_id, fahrer_id, fahrerlohn, gebuehr, gesamt)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [job_id, firma_id, fahrer_id, fahrerlohn, gebuehr, gesamt]
    );
    return { id: result.lastID, job_id, firma_id, fahrer_id, fahrerlohn, gebuehr, gesamt };
}

export async function getInvoices() {
    return await db.all('SELECT * FROM invoices ORDER BY created_at DESC');
}

export async function getInvoiceById(id) {
    return await db.get('SELECT * FROM invoices WHERE id = ?', [id]);
}

export async function getAdminStats() {
    const users = await db.get('SELECT COUNT(*) AS c FROM users');
    const jobs = await db.get('SELECT COUNT(*) AS c FROM jobs');
    const invoices = await db.get('SELECT COUNT(*) AS c FROM invoices');
    const umsatz = await db.get('SELECT SUM(gebuehr) AS sum FROM invoices');
    return {
        userCount: users.c,
        jobCount: jobs.c,
        invoiceCount: invoices.c,
        umsatz: umsatz.sum || 0
    };
}
