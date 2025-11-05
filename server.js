const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const helmet = require('helmet');
const Database = require('better-sqlite3');
const fs = require('fs');
const { PDFDocument, StandardFonts } = require('pdf-lib');

const app = express();
app.use(helmet());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');

// Session (simple)
app.use(session({
  secret: process.env.SESSION_SECRET || 'change_me',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false }
}));

// DB setup
const dbFile = path.join(__dirname, 'data', 'certs.db');
fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
const db = new Database(dbFile);

// Initialize table
db.prepare(`CREATE TABLE IF NOT EXISTS certificates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cert_id TEXT UNIQUE,
  name TEXT,
  project TEXT,
  start_date TEXT,
  end_date TEXT,
  issue_date TEXT,
  signature TEXT,
  notes TEXT
)`).run();

// Seed example certificate if not exists
const existing = db.prepare('SELECT count(*) as c FROM certificates').get();
if (existing.c === 0) {
  db.prepare('INSERT INTO certificates (cert_id, name, project, start_date, end_date, issue_date, signature, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('ALX-2025-001','Lucky KN','CartoonBot Automation','01 Oct 2025','31 Oct 2025','31 Oct 2025','Authorized Signatory','Seeded entry');
}

// Helper: require auth
function requireAuth(req, res, next) {
  if (req.session && req.session.user === 'admin') return next();
  return res.redirect('/admin/login');
}

// Routes
app.get('/', (req, res) => {
  const certs = db.prepare('SELECT id, cert_id, name, project, issue_date FROM certificates ORDER BY id DESC').all();
  res.render('index', { certs });
});

app.get('/cert/:certId', (req, res) => {
  const cert = db.prepare('SELECT * FROM certificates WHERE cert_id = ?').get(req.params.certId);
  if (!cert) return res.status(404).send('Certificate not found');
  res.render('certificate', { cert });
});

app.get('/api/certificates.json', (req, res) => {
  const certs = db.prepare('SELECT cert_id, name, project, issue_date FROM certificates').all();
  res.json(certs);
});

app.get('/verify', (req, res) => {
  const id = req.query.cert;
  if (!id) return res.render('verify', { result: null });
  const cert = db.prepare('SELECT cert_id, name, project, issue_date FROM certificates WHERE cert_id = ?').get(id);
  res.render('verify', { result: cert });
});

// PDF download
app.get('/cert/:certId/pdf', async (req, res) => {
  const cert = db.prepare('SELECT * FROM certificates WHERE cert_id = ?').get(req.params.certId);
  if (!cert) return res.status(404).send('Certificate not found');

  // Create simple PDF using pdf-lib
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([842, 595]); // landscape A4
  const times = await pdfDoc.embedFont(StandardFonts.TimesRoman);

  page.drawText('Certificate of Completion', { x: 60, y: 470, size: 28, font: times });
  page.drawText(`This certifies that ${cert.name}`, { x: 60, y: 420, size: 18, font: times });
  page.drawText(`Project: ${cert.project}`, { x: 60, y: 390, size: 14, font: times });
  page.drawText(`Duration: ${cert.start_date} - ${cert.end_date}`, { x: 60, y: 360, size: 12, font: times });
  page.drawText(`Issue Date: ${cert.issue_date}`, { x: 60, y: 330, size: 12, font: times });

  // Add signature text
  page.drawText(cert.signature || 'Authorized Signatory', { x: 60, y: 240, size: 12, font: times });

  const pdfBytes = await pdfDoc.save();
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=${cert.cert_id}.pdf`);
  res.send(Buffer.from(pdfBytes));
});

// Admin routes
app.get('/admin/login', (req, res) => res.render('admin_login', { error: null }));
app.post('/admin/login', (req, res) => {
  const pass = process.env.ADMIN_PASSWORD || 'alfoxadmin';
  if (req.body.password === pass) {
    req.session.user = 'admin';
    return res.redirect('/admin');
  }
  res.render('admin_login', { error: 'Invalid password' });
});
app.get('/admin/logout', (req, res) => { req.session.destroy(() => res.redirect('/')); });

app.get('/admin', requireAuth, (req, res) => {
  const certs = db.prepare('SELECT * FROM certificates ORDER BY id DESC').all();
  res.render('admin', { certs });
});

app.post('/admin/create', requireAuth, (req, res) => {
  const certId = req.body.cert_id || `ALX-${Date.now()}`;
  try {
    db.prepare('INSERT INTO certificates (cert_id, name, project, start_date, end_date, issue_date, signature, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(certId, req.body.name, req.body.project, req.body.start_date, req.body.end_date, req.body.issue_date, req.body.signature, req.body.notes);
    return res.redirect('/admin');
  } catch (e) {
    return res.send('Error: ' + e.message);
  }
});

app.post('/admin/delete', requireAuth, (req, res) => {
  db.prepare('DELETE FROM certificates WHERE id = ?').run(req.body.id);
  res.redirect('/admin');
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Alfox Cert Portal running on port ${PORT}`));