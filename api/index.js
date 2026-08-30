import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import QRCode from 'qrcode';
import pg from 'pg';
import crypto from 'crypto';

const { Pool } = pg;
const app = express();
const databaseUrl = process.env.DATABASE_URL;
const jwtSecret = process.env.JWT_SECRET || '';
const adminHash = process.env.ADMIN_PASSWORD_HASH || '';
const storeName = process.env.STORE_NAME || 'Video Selling';
const upiId = process.env.UPI_ID || '';

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: databaseUrl && /localhost|127\\.0\\.1/.test(databaseUrl) ? false : { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

const cleanText = (v, max = 500) => String(v ?? '').trim().slice(0, max);
const cleanInt = (v, fallback = 0) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n) : fallback; };
const features = v => Array.isArray(v) ? v.map(x => cleanText(x, 120)).filter(Boolean).slice(0, 20) : [];
const discountPercent = (original, sale) => original > 0 && sale < original ? Math.round(((original - sale) / original) * 100) : 0;

function upiUri(name, amount) {
  return `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(storeName)}&am=${encodeURIComponent(Number(amount).toFixed(2))}&cu=INR&tn=${encodeURIComponent(name + ' package')}`;
}

async function activeOfferFor(packageId) {
  const r = await pool.query(`SELECT * FROM offers WHERE package_id=$1 AND active=true AND (start_at IS NULL OR start_at<=NOW()) AND (end_at IS NULL OR end_at>=NOW()) ORDER BY created_at DESC LIMIT 1`, [packageId]);
  return r.rows[0] || null;
}

async function publicPackage(row) {
  const offer = await activeOfferFor(row.id);
  const original = offer?.original_price ?? row.original_price ?? row.price;
  const sale = offer?.sale_price ?? row.price;
  return { ...row, price: sale, base_price: row.price, original_price: original, discount_percent: discountPercent(original, sale), offer: offer ? { id: offer.id, name: offer.name, description: offer.description } : null };
}

function auth(req, res, next) {
  try {
    if (!jwtSecret) return res.status(401).json({ error: 'Unauthorized' });
    const token = req.cookies.admin_token;
    const payload = jwt.verify(token, jwtSecret);
    if (payload.role !== 'admin') throw new Error('bad role');
    req.admin = payload;
    next();
  } catch { res.status(401).json({ error: 'Unauthorized' }); }
}

app.get('/health', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true }); }
  catch { res.status(503).json({ ok: false }); }
});

app.get('/api/config', async (_req, res) => {
  try {
    const r = await pool.query(`SELECT key,value FROM settings WHERE key = ANY($1)`, [['store_name','telegram_1','telegram_2','email','phone','support_hours','announcement','refund_summary','delivery_summary']]);
    const s = Object.fromEntries(r.rows.map(x => [x.key, x.value]));
    res.json({ storeName: s.store_name || storeName, upiId, telegram: [s.telegram_1, s.telegram_2].filter(Boolean), email: s.email || '', phone: s.phone || '', supportHours: s.support_hours || '', announcement: s.announcement || '', refundSummary: s.refund_summary || '', deliverySummary: s.delivery_summary || '' });
  } catch { res.status(500).json({ error: 'Unable to load configuration.' }); }
});

app.get('/api/packages', async (_req, res) => {
  try {
    const r = await pool.query(`SELECT * FROM packages WHERE active=true ORDER BY sort_order,id`);
    res.json(await Promise.all(r.rows.map(publicPackage)));
  } catch (e) { console.error('packages:', e); res.status(500).json({ error: 'Unable to load packages.' }); }
});

app.get('/api/groups', async (_req, res) => {
  try { res.json((await pool.query(`SELECT * FROM groups_catalog WHERE active=true ORDER BY sort_order,id`)).rows); }
  catch (e) { console.error('groups:', e); res.status(500).json({ error: 'Unable to load groups.' }); }
});

app.get('/api/offers', async (_req, res) => {
  try {
    const r = await pool.query(`SELECT o.*,p.name AS package_name FROM offers o JOIN packages p ON p.id=o.package_id WHERE o.active=true AND (o.start_at IS NULL OR o.start_at<=NOW()) AND (o.end_at IS NULL OR o.end_at>=NOW()) ORDER BY o.created_at DESC`);
    res.json(r.rows.map(o => ({ ...o, discount_percent: discountPercent(o.original_price, o.sale_price) })));
  } catch (e) { console.error('offers:', e); res.status(500).json({ error: 'Unable to load offers.' }); }
});

app.get('/api/qr/:id', async (req, res) => {
  try {
    if (!upiId) return res.status(503).send('UPI is not configured.');
    const p = await pool.query(`SELECT id,name,price FROM packages WHERE id=$1 AND active=true`, [req.params.id]);
    if (!p.rowCount) return res.status(404).send('Package not found.');
    const offer = await activeOfferFor(p.rows[0].id);
    const amount = offer?.sale_price ?? p.rows[0].price;
    const buffer = await QRCode.toBuffer(upiUri(p.rows[0].name, amount), { type: 'png', width: 480, margin: 2, errorCorrectionLevel: 'M' });
    res.type('png').set('Cache-Control', 'no-store, no-cache, must-revalidate').send(buffer);
  } catch (e) { console.error('qr:', e); res.status(500).send('Unable to generate QR.'); }
});

app.post('/api/orders', async (req, res) => {
  try {
    const packageId = cleanInt(req.body.packageId);
    const customerName = cleanText(req.body.customerName, 80);
    const customerContact = cleanText(req.body.customerContact, 120);
    const utr = cleanText(req.body.utr, 80);
    if (!packageId || !customerName || !customerContact) return res.status(400).json({ error: 'Please complete the required fields.' });
    const p = await pool.query(`SELECT id,name,price FROM packages WHERE id=$1 AND active=true`, [packageId]);
    if (!p.rowCount) return res.status(404).json({ error: 'Package unavailable.' });
    const offer = await activeOfferFor(packageId);
    const amount = offer?.sale_price ?? p.rows[0].price;
    const original = offer?.original_price ?? p.rows[0].price;
    const id = crypto.randomUUID();
    await pool.query(`INSERT INTO orders(id,package_id,package_name,amount,original_amount,offer_id,customer_name,customer_contact,utr) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [id,p.rows[0].id,p.rows[0].name,amount,original,offer?.id ?? null,customerName,customerContact,utr]);
    res.status(201).json({ orderId: id, message: 'Order submitted successfully. Please keep your Order ID for support.' });
  } catch (e) { console.error('orders:', e); res.status(500).json({ error: 'Could not submit the order.' }); }
});

app.post('/api/admin/login', async (req, res) => {
  try {
    if (!adminHash || !jwtSecret) return res.status(503).json({ error: 'Admin authentication is not configured.' });
    const pin = String(req.body.pin ?? '');
    const ok = pin.length <= 128 && await bcrypt.compare(pin, adminHash);
    if (!ok) return res.status(401).json({ error: 'Invalid PIN.' });
    const token = jwt.sign({ role: 'admin' }, jwtSecret, { expiresIn: '7d' });
    res.cookie('admin_token', token, { httpOnly: true, sameSite: 'lax', secure: true, maxAge: 7 * 86400000, path: '/' }).json({ ok: true });
  } catch { res.status(500).json({ error: 'Login failed.' }); }
});
app.post('/api/admin/logout', auth, (_req,res) => res.clearCookie('admin_token', { path: '/' }).json({ ok: true }));
app.get('/api/admin/me', auth, (_req,res) => res.json({ ok: true }));

app.get('/api/admin/stats', auth, async (_req,res) => {
  try {
    const [p,g,o,ord] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int n FROM packages WHERE active=true`),
      pool.query(`SELECT COUNT(*)::int n FROM groups_catalog WHERE active=true`),
      pool.query(`SELECT COUNT(*)::int n FROM offers WHERE active=true`),
      pool.query(`SELECT COUNT(*)::int n FROM orders`)
    ]);
    res.json({ packages:p.rows[0].n, groups:g.rows[0].n, offers:o.rows[0].n, orders:ord.rows[0].n });
  } catch { res.status(500).json({ error: 'Unable to load dashboard.' }); }
});

app.get('/api/admin/packages', auth, async (_req,res) => { try { res.json((await pool.query(`SELECT * FROM packages ORDER BY sort_order,id`)).rows); } catch { res.status(500).json({error:'Unable to load packages.'}); } });
app.get('/api/admin/groups', auth, async (_req,res) => { try { res.json((await pool.query(`SELECT * FROM groups_catalog ORDER BY sort_order,id`)).rows); } catch { res.status(500).json({error:'Unable to load groups.'}); } });
app.get('/api/admin/offers', auth, async (_req,res) => { try { res.json((await pool.query(`SELECT o.*,p.name AS package_name FROM offers o JOIN packages p ON p.id=o.package_id ORDER BY o.created_at DESC`)).rows); } catch { res.status(500).json({error:'Unable to load offers.'}); } });
app.get('/api/admin/orders', auth, async (_req,res) => { try { res.json((await pool.query(`SELECT * FROM orders ORDER BY created_at DESC`)).rows); } catch { res.status(500).json({error:'Unable to load orders.'}); } });
app.get('/api/admin/settings', auth, async (_req,res) => { try { res.json((await pool.query(`SELECT key,value FROM settings ORDER BY key`)).rows); } catch { res.status(500).json({error:'Unable to load settings.'}); } });

export default app;
