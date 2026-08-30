import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';
import QRCode from 'qrcode';

const store = getStore('video-selling');
const sessions = new Map();

const seed = () => ({
  storeName: 'Video Selling',
  upiId: 'jaduuugarrr@okaxis',
  telegram: ['ZzzNnnVvvv', 'Ramerusaan'],
  email: '', phone: '', supportHours: 'Support available for order assistance.',
  announcement: '', refundSummary: 'Digital purchases are generally final after successful delivery, subject to applicable law.',
  deliverySummary: 'Digital access details are provided after payment confirmation.',
  heroTitle: '', heroSubtitle: '', footerText: '',
  packages: [
    ['Prime Access',149,199,'POPULAR'],['Exclusive Access',249,299,'VALUE'],['VIP Access',299,399,'VIP'],
    ['VIP Elite',349,449,'BEST VALUE'],['VVIP Access',399,499,'VVIP'],['VVIP Black',449,599,'BLACK'],['Ultra Elite',499,699,'ULTRA']
  ].map((x,i)=>({id:`p${i+1}`,name:x[0],price:x[1],original_price:x[2],badge:x[3],description:'Digital access.',features:['Instant access','24×7 support'],active:true,sort_order:i+1})),
  groups: [], offers: [], orders: [], faqs: [],
  policies: {terms:'',refund:'',privacy:'',digitalGoods:''},
  adminPin: process.env.ADMIN_PIN || '1234'
});

async function read() {
  const data = await store.get('store.json', { type: 'json' });
  if (data) return data;
  const initial = seed();
  await store.setJSON('store.json', initial);
  return initial;
}
async function write(data) { await store.setJSON('store.json', data); }
function tokenFrom(event) { return (event.headers?.authorization || event.headers?.Authorization || '').replace(/^Bearer\s+/i,''); }
function authorized(event) { const token = tokenFrom(event); return !!token && sessions.has(token); }
function json(statusCode, body) { return { statusCode, headers: {'content-type':'application/json; charset=utf-8','cache-control':'no-store'}, body: JSON.stringify(body) }; }
function body(event) { try { return event.body ? JSON.parse(event.body) : {}; } catch { return {}; } }

export default async (event) => {
  try {
    const path = event.path.replace(/^\/.netlify\/functions\/api/, '').replace(/^\/api/, '') || '/';
    const method = event.httpMethod;

    if (path === '/health' && method === 'GET') return json(200,{ok:true,mode:'netlify-blobs'});

    if (path === '/admin/login' && method === 'POST') {
      const b=body(event), s=await read();
      if (String(b.pin||'') !== String(s.adminPin || process.env.ADMIN_PIN || '1234')) return json(401,{error:'Incorrect PIN'});
      const token=crypto.randomBytes(24).toString('hex'); sessions.set(token,Date.now()+86400000);
      return json(200,{token});
    }
    if (path === '/admin/logout' && method === 'POST') { sessions.delete(tokenFrom(event)); return json(200,{ok:true}); }
    if (path === '/admin/session' && method === 'GET') return authorized(event)?json(200,{ok:true}):json(401,{error:'Unauthorized'});

    if (path === '/store' && method === 'GET') return json(200,await read());
    if (path === '/admin/store' && method === 'GET') return authorized(event)?json(200,await read()):json(401,{error:'Unauthorized'});

    if (path === '/admin/store' && method === 'PUT') {
      if (!authorized(event)) return json(401,{error:'Unauthorized'});
      const current=await read(), b=body(event), next={...current,...b};
      for (const k of ['packages','groups','offers','orders','faqs']) if (!Array.isArray(b[k])) next[k]=current[k];
      next.policies=b.policies || current.policies;
      next.adminPin=current.adminPin || process.env.ADMIN_PIN || '1234';
      await write(next); return json(200,next);
    }

    if (path === '/orders' && method === 'POST') {
      const s=await read(), b=body(event);
      if (!String(b.customerName||'').trim() || !b.packageName || !Number(b.amount)) return json(400,{error:'Name, product and amount are required'});
      const order={id:b.id||`ORD-${Date.now().toString(36).toUpperCase()}`,packageId:b.packageId||null,packageName:String(b.packageName),amount:Number(b.amount),customerName:String(b.customerName).trim(),status:'pending',createdAt:new Date().toISOString()};
      s.orders.unshift(order); await write(s); return json(201,order);
    }

    if (path === '/qr' && method === 'GET') {
      const q=event.queryStringParameters||{}, upi=String(q.upi||''), name=String(q.name||'Video Selling'), amount=Number(q.amount||0);
      if (!upi || !amount) return {statusCode:400,headers:{'content-type':'text/plain'},body:'UPI and amount are required.'};
      const uri=`upi://pay?pa=${encodeURIComponent(upi)}&pn=${encodeURIComponent(name)}&am=${encodeURIComponent(amount.toFixed(2))}&cu=INR`;
      const png=await QRCode.toBuffer(uri,{type:'png',width:480,margin:2,errorCorrectionLevel:'M'});
      return {statusCode:200,headers:{'content-type':'image/png','cache-control':'no-store'},isBase64Encoded:true,body:png.toString('base64')};
    }

    return json(404,{error:'Not found'});
  } catch (e) {
    console.error(e);
    return json(500,{error:'Internal server error'});
  }
};
