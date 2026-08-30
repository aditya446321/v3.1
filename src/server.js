import express from 'express';
import helmet from 'helmet';
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {fileURLToPath} from 'url';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const app=express();
const port=Number(process.env.PORT||3000);
const dataDir=process.env.DATA_DIR||path.join(__dirname,'../data');
const dataFile=path.join(dataDir,'store.json');
const adminPin=String(process.env.ADMIN_PIN||'1234');
const sessions=new Set();
app.disable('x-powered-by');
app.use(helmet({contentSecurityPolicy:false}));
app.use(express.json({limit:'1mb'}));

const seed=()=>({
 storeName:'Video Selling',upiId:'jaduuugarrr@okaxis',telegram:['ZzzNnnVvvv','Ramerusaan'],email:'',phone:'',supportHours:'Support available for order assistance.',announcement:'',
 refundSummary:'Digital purchases are generally final after successful delivery, subject to applicable law.',deliverySummary:'Digital access details are provided after payment confirmation.',
 packages:[
  ['Prime Access',149,199,'POPULAR'],['Exclusive Access',249,299,'VALUE'],['VIP Access',299,399,'VIP'],['VIP Elite',349,449,'BEST VALUE'],['VVIP Access',399,499,'VVIP'],['VVIP Black',449,599,'BLACK'],['Ultra Elite',499,699,'ULTRA']
 ].map((x,i)=>({id:'p'+(i+1),name:x[0],price:x[1],original_price:x[2],badge:x[3],description:'Digital access.',features:['Instant access','24×7 support'],active:true,sort_order:i+1})),
 groups:[],offers:[],orders:[],faqs:[],policies:{terms:'',refund:'',privacy:'',digitalGoods:''}
});
function read(){try{return JSON.parse(fs.readFileSync(dataFile,'utf8'))}catch{return seed()}}
function write(s){fs.mkdirSync(dataDir,{recursive:true});fs.writeFileSync(dataFile,JSON.stringify(s,null,2))}
if(!fs.existsSync(dataFile))write(seed());
function auth(req,res,next){const token=req.get('authorization')?.replace(/^Bearer\s+/i,'');if(!token||!sessions.has(token))return res.status(401).json({error:'Unauthorized'});next()}
const clean=(s)=>{const x={...s};delete x.adminPin;return x};
app.get('/health',(_req,res)=>res.json({ok:true,mode:'portable-admin'}));
app.post('/api/admin/login',(req,res)=>{if(String(req.body?.pin||'')!==adminPin)return res.status(401).json({error:'Incorrect PIN'});const token=crypto.randomBytes(24).toString('hex');sessions.add(token);res.json({token})});
app.post('/api/admin/logout',auth,(req,res)=>{sessions.delete(req.get('authorization').replace(/^Bearer\s+/i,''));res.json({ok:true})});
app.get('/api/store',(_req,res)=>res.json(clean(read())));
app.get('/api/admin/store',auth,(_req,res)=>res.json(read()));
app.put('/api/admin/store',auth,(req,res)=>{const current=read();const next={...current,...req.body};next.packages=Array.isArray(req.body.packages)?req.body.packages:current.packages;next.groups=Array.isArray(req.body.groups)?req.body.groups:current.groups;next.offers=Array.isArray(req.body.offers)?req.body.offers:current.offers;next.orders=Array.isArray(req.body.orders)?req.body.orders:current.orders;next.faqs=Array.isArray(req.body.faqs)?req.body.faqs:current.faqs;next.policies=req.body.policies||current.policies;write(next);res.json(clean(next))});
app.get('/api/qr',async(req,res)=>{try{const upi=String(req.query.upi||''),name=String(req.query.name||'Video Selling'),amount=Number(req.query.amount||0);if(!upi||!amount)return res.status(400).send('UPI and amount are required.');const uri=`upi://pay?pa=${encodeURIComponent(upi)}&pn=${encodeURIComponent(name)}&am=${encodeURIComponent(amount.toFixed(2))}&cu=INR`;res.type('png').set('Cache-Control','no-store').send(await QRCode.toBuffer(uri,{type:'png',width:480,margin:2,errorCorrectionLevel:'M'}))}catch{return res.status(500).send('Unable to generate QR.')}});
app.use(express.static(path.join(__dirname,'../public'),{extensions:['html']}));
app.listen(port,()=>console.log(`Video Selling running on ${port}`));
