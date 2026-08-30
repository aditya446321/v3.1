import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import QRCode from 'qrcode';
import pg from 'pg';
import dotenv from 'dotenv';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();
const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3000);
const databaseUrl = process.env.DATABASE_URL;
const jwtSecret = process.env.JWT_SECRET;
const adminHash = process.env.ADMIN_PASSWORD_HASH;
const storeName = process.env.STORE_NAME || 'Video Selling';
const upiId = process.env.UPI_ID || '';
const pool = new Pool({
  connectionString: databaseUrl,
  ssl: databaseUrl && /localhost|127\.0\.0\.1/.test(databaseUrl) ? false : { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

if (!databaseUrl) console.warn('DATABASE_URL is not configured. The server cannot start until it is set.');
if (!jwtSecret || jwtSecret.length < 32) console.warn('JWT_SECRET should be at least 32 characters in production.');
if (!adminHash) console.warn('ADMIN_PASSWORD_HASH is not configured. Admin login will fail until it is set.');

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false, referrerPolicy: { policy: 'strict-origin-when-cross-origin' } }));
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '../public'), { extensions: ['html'] }));

const loginAttempts = new Map();
function rateLimitLogin(req, res, next) {
  const key = req.ip || 'unknown';
  const now = Date.now();
  const recent = (loginAttempts.get(key) || []).filter(t => now - t < 10 * 60 * 1000);
  if (recent.length >= 10) return res.status(429).json({ error: 'Too many login attempts. Try again later.' });
  recent.push(now); loginAttempts.set(key, recent); next();
}
function cleanText(value, max = 500) { return String(value ?? '').trim().slice(0, max); }
function cleanInt(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? Math.round(n) : fallback; }
function safeFeatures(value) { return Array.isArray(value) ? value.map(v => cleanText(v, 120)).filter(Boolean).slice(0, 20) : []; }
function requireSameOrigin(req, res, next) {
  if (!['POST','PATCH','PUT','DELETE'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (!origin) return next();
  try { const a = new URL(origin); const host = req.get('host'); if (a.host !== host) return res.status(403).json({ error: 'Origin not allowed.' }); } catch { return res.status(403).json({ error: 'Origin not allowed.' }); }
  next();
}
app.use(requireSameOrigin);

function auth(req, res, next) {
  try {
    if (!jwtSecret) throw new Error('Missing secret');
    const token = req.cookies.admin_token;
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    const payload = jwt.verify(token, jwtSecret);
    if (payload.role !== 'admin') throw new Error('Bad role');
    req.admin = payload;
    next();
  } catch { return res.status(401).json({ error: 'Unauthorized' }); }
}
function cookieOptions() { return { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 7 * 86400000, path: '/' }; }
function upiUri(name, amount) {
  return `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(storeName)}&am=${encodeURIComponent(Number(amount).toFixed(2))}&cu=INR&tn=${encodeURIComponent(name + ' package')}`;
}
function discountPercent(original, sale) { return original > 0 && sale < original ? Math.round(((original - sale) / original) * 100) : 0; }

async function activeOfferFor(packageId) {
  const r = await pool.query(`SELECT * FROM offers WHERE package_id=$1 AND active=true AND (start_at IS NULL OR start_at<=NOW()) AND (end_at IS NULL OR end_at>=NOW()) ORDER BY created_at DESC LIMIT 1`, [packageId]);
  return r.rows[0] || null;
}
async function publicPackageRow(row) {
  const offer = await activeOfferFor(row.id);
  const original = offer?.original_price ?? row.original_price ?? row.price;
  const sale = offer?.sale_price ?? row.price;
  return { ...row, price: sale, base_price: row.price, original_price: original, discount_percent: discountPercent(original, sale), offer: offer ? { id: offer.id, name: offer.name, description: offer.description } : null };
}

app.get('/health', async (_req, res) => { try { await pool.query('SELECT 1'); res.json({ ok: true }); } catch { res.status(503).json({ ok: false }); } });
app.get('/api/config', async (_req, res) => {
  const settings = await pool.query(`SELECT key,value FROM settings WHERE key = ANY($1)`, [['store_name','telegram_1','telegram_2','email','phone','support_hours','announcement','refund_summary','delivery_summary']]);
  const s = Object.fromEntries(settings.rows.map(x => [x.key, x.value]));
  res.json({ storeName: s.store_name || storeName, upiId, telegram: [s.telegram_1, s.telegram_2].filter(Boolean), email: s.email || '', phone: s.phone || '', supportHours: s.support_hours || '', announcement: s.announcement || '', refundSummary: s.refund_summary || '', deliverySummary: s.delivery_summary || '' });
});
app.get('/api/packages', async (_req, res) => { try { const r = await pool.query(`SELECT * FROM packages WHERE active=true ORDER BY sort_order,id`); res.json(await Promise.all(r.rows.map(publicPackageRow))); } catch { res.status(500).json({ error: 'Unable to load packages.' }); } });
app.get('/api/groups', async (_req, res) => { try { const r = await pool.query(`SELECT * FROM groups_catalog WHERE active=true ORDER BY sort_order,id`); res.json(r.rows); } catch { res.status(500).json({ error: 'Unable to load groups.' }); } });
app.get('/api/offers', async (_req, res) => { try { const r = await pool.query(`SELECT o.*,p.name AS package_name FROM offers o JOIN packages p ON p.id=o.package_id WHERE o.active=true AND (o.start_at IS NULL OR o.start_at<=NOW()) AND (o.end_at IS NULL OR o.end_at>=NOW()) ORDER BY o.created_at DESC`); res.json(r.rows.map(o => ({ ...o, discount_percent: discountPercent(o.original_price, o.sale_price) }))); } catch { res.status(500).json({ error: 'Unable to load offers.' }); } });
app.get('/api/qr/:id', async (req, res) => {
  try {
    if (!upiId) return res.status(503).send('UPI is not configured.');
    const p = await pool.query(`SELECT id,name,price FROM packages WHERE id=$1 AND active=true`, [req.params.id]);
    if (!p.rowCount) return res.status(404).send('Package not found.');
    const offer = await activeOfferFor(p.rows[0].id);
    const amount = offer?.sale_price ?? p.rows[0].price;
    const buffer = await QRCode.toBuffer(upiUri(p.rows[0].name, amount), { type: 'png', width: 480, margin: 2, errorCorrectionLevel: 'M' });
    res.type('png').set('Cache-Control', 'no-store, no-cache, must-revalidate').send(buffer);
  } catch { res.status(500).send('Unable to generate QR.'); }
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
  } catch { res.status(500).json({ error: 'Could not submit the order.' }); }
});

app.post('/api/admin/login', rateLimitLogin, async (req, res) => {
  try {
    if (!adminHash || !jwtSecret) return res.status(503).json({ error: 'Admin authentication is not configured.' });
    const pin = String(req.body.pin ?? '');
    if (!pin || pin.length > 128) return res.status(401).json({ error: 'Invalid PIN.' });
    const ok = await bcrypt.compare(pin, adminHash);
    if (!ok) return res.status(401).json({ error: 'Invalid PIN.' });
    const token = jwt.sign({ role: 'admin' }, jwtSecret, { expiresIn: '7d' });
    res.cookie('admin_token', token, cookieOptions()).json({ ok: true });
  } catch { res.status(500).json({ error: 'Login failed.' }); }
});
app.post('/api/admin/logout', auth, (_req,res) => res.clearCookie('admin_token', { path: '/' }).json({ ok: true }));
app.get('/api/admin/me', auth, (_req,res) => res.json({ ok: true }));
app.get('/api/admin/stats', auth, async (_req,res) => { try { const [p,g,o,ord] = await Promise.all([pool.query(`SELECT COUNT(*)::int n FROM packages WHERE active=true`),pool.query(`SELECT COUNT(*)::int n FROM groups_catalog WHERE active=true`),pool.query(`SELECT COUNT(*)::int n FROM offers WHERE active=true`),pool.query(`SELECT COUNT(*)::int n FROM orders`)]); res.json({packages:p.rows[0].n,groups:g.rows[0].n,offers:o.rows[0].n,orders:ord.rows[0].n}); } catch { res.status(500).json({error:'Unable to load dashboard.'}); } });

app.get('/api/admin/packages', auth, async (_req,res) => res.json((await pool.query(`SELECT * FROM packages ORDER BY sort_order,id`)).rows));
app.post('/api/admin/packages', auth, async (req,res) => {
  try {
    const id = cleanInt(req.body.id, 0), name=cleanText(req.body.name,100), price=cleanInt(req.body.price), originalPrice=cleanInt(req.body.originalPrice,0), description=cleanText(req.body.description,500), badge=cleanText(req.body.badge,40), active=req.body.active!==false, sortOrder=cleanInt(req.body.sortOrder,0), features=safeFeatures(req.body.features);
    if (!name || price <= 0) return res.status(400).json({error:'Name and a valid price are required.'});
    const original = originalPrice > 0 ? originalPrice : null;
    const q = id ? `UPDATE packages SET name=$1,price=$2,original_price=$3,description=$4,features=$5,badge=$6,active=$7,sort_order=$8,updated_at=NOW() WHERE id=$9 RETURNING *` : `INSERT INTO packages(name,price,original_price,description,features,badge,active,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`;
    const args = id ? [name,price,original,description,JSON.stringify(features),badge,active,sortOrder,id] : [name,price,original,description,JSON.stringify(features),badge,active,sortOrder];
    const r=await pool.query(q,args); if(!r.rowCount)return res.status(404).json({error:'Package not found.'}); res.json(r.rows[0]);
  } catch { res.status(500).json({error:'Could not save package.'}); }
});
app.delete('/api/admin/packages/:id', auth, async (req,res) => { try { await pool.query(`UPDATE packages SET active=false,updated_at=NOW() WHERE id=$1`, [req.params.id]); res.json({ok:true}); } catch { res.status(500).json({error:'Could not archive package.'}); } });

app.get('/api/admin/groups', auth, async (_req,res) => res.json((await pool.query(`SELECT * FROM groups_catalog ORDER BY sort_order,id`)).rows));
app.post('/api/admin/groups', auth, async (req,res) => { try { const id=cleanInt(req.body.id,0), name=cleanText(req.body.name,120); if(!name)return res.status(400).json({error:'Group name is required.'}); const vals=[name,cleanText(req.body.description,500),Math.max(0,cleanInt(req.body.price)),cleanText(req.body.link,500),cleanText(req.body.contact,120),cleanText(req.body.category,80),cleanText(req.body.contentCount,80),req.body.active!==false,cleanInt(req.body.sortOrder,0)]; const q=id?`UPDATE groups_catalog SET name=$1,description=$2,price=$3,link=$4,contact=$5,category=$6,content_count=$7,active=$8,sort_order=$9,updated_at=NOW() WHERE id=$10 RETURNING *`:`INSERT INTO groups_catalog(name,description,price,link,contact,category,content_count,active,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`; const r=await pool.query(q,id?[...vals,id]:vals); if(!r.rowCount)return res.status(404).json({error:'Group not found.'}); res.json(r.rows[0]); } catch { res.status(500).json({error:'Could not save group.'}); } });
app.delete('/api/admin/groups/:id', auth, async (req,res)=>{try{await pool.query(`UPDATE groups_catalog SET active=false,updated_at=NOW() WHERE id=$1`,[req.params.id]);res.json({ok:true});}catch{res.status(500).json({error:'Could not archive group.'});}});

app.get('/api/admin/offers', auth, async (_req,res)=>res.json((await pool.query(`SELECT o.*,p.name AS package_name FROM offers o JOIN packages p ON p.id=o.package_id ORDER BY o.created_at DESC`)).rows));
app.post('/api/admin/offers', auth, async (req,res)=>{try{const id=cleanInt(req.body.id,0), packageId=cleanInt(req.body.packageId), name=cleanText(req.body.name,120), description=cleanText(req.body.description,500), originalPrice=cleanInt(req.body.originalPrice), salePrice=cleanInt(req.body.salePrice), startAt=req.body.startAt||null,endAt=req.body.endAt||null,active=req.body.active!==false;if(!packageId||!name||originalPrice<=0||salePrice<=0||salePrice>originalPrice)return res.status(400).json({error:'Enter a valid package, original price, and sale price.'});const q=id?`UPDATE offers SET package_id=$1,name=$2,description=$3,original_price=$4,sale_price=$5,start_at=$6,end_at=$7,active=$8,updated_at=NOW() WHERE id=$9 RETURNING *`:`INSERT INTO offers(package_id,name,description,original_price,sale_price,start_at,end_at,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`;const vals=[packageId,name,description,originalPrice,salePrice,startAt,endAt,active];const r=await pool.query(q,id?[...vals,id]:vals);if(!r.rowCount)return res.status(404).json({error:'Offer not found.'});res.json(r.rows[0]);}catch{res.status(500).json({error:'Could not save offer.'});}});
app.delete('/api/admin/offers/:id', auth, async (req,res)=>{try{await pool.query(`DELETE FROM offers WHERE id=$1`,[req.params.id]);res.json({ok:true});}catch{res.status(500).json({error:'Could not delete offer.'});}});

app.get('/api/admin/orders', auth, async (_req,res)=>res.json((await pool.query(`SELECT * FROM orders ORDER BY created_at DESC LIMIT 500`)).rows));
app.patch('/api/admin/orders/:id', auth, async (req,res)=>{try{const status=cleanText(req.body.status,20);if(!['pending','approved','rejected'].includes(status))return res.status(400).json({error:'Invalid status.'});const r=await pool.query(`UPDATE orders SET status=$1 WHERE id=$2 RETURNING *`,[status,req.params.id]);if(!r.rowCount)return res.status(404).json({error:'Order not found.'});res.json(r.rows[0]);}catch{res.status(500).json({error:'Could not update order.'});}});

app.get('/api/admin/settings', auth, async (_req,res)=>res.json(Object.fromEntries((await pool.query(`SELECT key,value FROM settings ORDER BY key`)).rows.map(x=>[x.key,x.value]))));
app.post('/api/admin/settings', auth, async (req,res)=>{try{const allowed=['store_name','telegram_1','telegram_2','email','phone','support_hours','announcement','terms_summary','refund_summary','delivery_summary'];for(const key of allowed){if(Object.prototype.hasOwnProperty.call(req.body,key)){await pool.query(`INSERT INTO settings(key,value,updated_at) VALUES($1,$2,NOW()) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`,[key,cleanText(req.body[key],1000)]);}}res.json({ok:true});}catch{res.status(500).json({error:'Could not save settings.'});}});

app.get('/admin', (_req,res)=>res.sendFile(path.join(__dirname,'../public/admin.html')));
app.use((req,res,next)=>{ if(req.path.startsWith('/api/')) return res.status(404).json({error:'Not found'}); res.status(404).sendFile(path.join(__dirname,'../public/404.html')); });

async function init() {
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  await pool.query(`CREATE TABLE IF NOT EXISTS _app_bootstrap_check(id INTEGER PRIMARY KEY, created_at TIMESTAMPTZ DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS packages(id BIGSERIAL PRIMARY KEY,name TEXT NOT NULL,price INTEGER NOT NULL CHECK(price>0),original_price INTEGER,description TEXT NOT NULL DEFAULT '',features JSONB NOT NULL DEFAULT '[]'::jsonb,badge TEXT NOT NULL DEFAULT '',active BOOLEAN NOT NULL DEFAULT TRUE,sort_order INTEGER NOT NULL DEFAULT 0,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS groups_catalog(id BIGSERIAL PRIMARY KEY,name TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',price INTEGER NOT NULL DEFAULT 0,link TEXT NOT NULL DEFAULT '',contact TEXT NOT NULL DEFAULT '',category TEXT NOT NULL DEFAULT '',content_count TEXT NOT NULL DEFAULT '',active BOOLEAN NOT NULL DEFAULT TRUE,sort_order INTEGER NOT NULL DEFAULT 0,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS offers(id BIGSERIAL PRIMARY KEY,package_id BIGINT NOT NULL REFERENCES packages(id) ON DELETE CASCADE,name TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',original_price INTEGER NOT NULL CHECK(original_price>0),sale_price INTEGER NOT NULL CHECK(sale_price>0 AND sale_price<=original_price),start_at TIMESTAMPTZ,end_at TIMESTAMPTZ,active BOOLEAN NOT NULL DEFAULT TRUE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS orders(id UUID PRIMARY KEY,package_id BIGINT REFERENCES packages(id) ON DELETE SET NULL,package_name TEXT NOT NULL,amount INTEGER NOT NULL CHECK(amount>0),original_amount INTEGER,offer_id BIGINT REFERENCES offers(id) ON DELETE SET NULL,customer_name TEXT NOT NULL,customer_contact TEXT NOT NULL,utr TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL DEFAULT '',updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  const c=await pool.query(`SELECT COUNT(*)::int n FROM packages`); if(c.rows[0].n===0){const seeds=[['Prime Access',99,'1,000+ Videos',['1,000+ Videos','Digital access','Telegram support'],'',0],['Exclusive Access',149,'2,000+ Videos',['2,000+ Videos','Digital access','Telegram support'],'',1],['VIP Access',199,'Any 2 Groups',['Any 2 Groups','Digital access','Telegram support'],'',2],['VIP Elite',249,'Any 3 Groups',['Any 3 Groups','Digital access','Telegram support'],'Popular',3],['VVIP Access',299,'2,000+ Videos',['2,000+ Videos','Digital access','Telegram support'],'',4],['VVIP Black',399,'Any 4 Groups',['Any 4 Groups','Digital access','Telegram support'],'',5],['Ultra Elite',499,'1,000+ Videos + Any 5 Groups',['1,000+ Videos','Any 5 Groups','Digital access','Telegram support'],'',6]];for(const s of seeds)await pool.query(`INSERT INTO packages(name,price,description,features,badge,sort_order) VALUES($1,$2,$3,$4,$5,$6)`,[s[0],s[1],s[2],JSON.stringify(s[3]),s[4],s[5]]);}
  const settings=[['store_name',storeName],['telegram_1',process.env.TELEGRAM_1||'ZzzNnnVvvv'],['telegram_2',process.env.TELEGRAM_2||'Ramerusaan'],['email',process.env.EMAIL||''],['phone',process.env.PHONE||''],['support_hours','Support hours: as listed on the store.'],['announcement','Secure checkout • Dynamic UPI QR • Fast support'],['terms_summary','Please review the package, price, description, and policies before purchase.'],['refund_summary','Digital purchases are generally final after successful delivery, subject to applicable law.'],['delivery_summary','Digital access instructions are provided through the configured support/delivery channel after order review.']];for(const [k,v] of settings)await pool.query(`INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO NOTHING`,[k,v]);
}

init().then(()=>app.listen(port,()=>console.log(`Video Selling running on :${port}`))).catch(err=>{console.error(err);process.exit(1)});
