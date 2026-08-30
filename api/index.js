import QRCode from 'qrcode';

export default async function handler(req,res){
  const url=new URL(req.url,`https://${req.headers.host||'localhost'}`);
  if(req.method==='GET'&&url.pathname.endsWith('/health')) return res.status(200).json({ok:true,mode:'local-admin'});
  if(req.method==='GET'&&url.pathname.includes('/api/qr')){
    const upi=url.searchParams.get('upi')||'';const name=url.searchParams.get('name')||'Video Selling';const amount=Number(url.searchParams.get('amount')||0);
    if(!upi||!amount)return res.status(400).send('UPI and amount are required.');
    try{const uri=`upi://pay?pa=${encodeURIComponent(upi)}&pn=${encodeURIComponent(name)}&am=${encodeURIComponent(amount.toFixed(2))}&cu=INR`;const png=await QRCode.toBuffer(uri,{type:'png',width:480,margin:2,errorCorrectionLevel:'M'});res.setHeader('Content-Type','image/png');res.setHeader('Cache-Control','no-store');return res.status(200).send(png)}catch{return res.status(500).send('Unable to generate QR.')}}
  return res.status(404).json({error:'Not found'});
}
