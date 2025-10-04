// server.js
import 'dotenv/config.js';
import express from 'express';
import cors from 'cors';
import crypto from 'crypto';

const PORT = process.env.PORT || 10000;
const RECEIVING_ADDR   = (process.env.RECEIVING_ADDR || '').toLowerCase();
const WEBHOOK_SECRET   = process.env.WEBHOOK_SECRET || '';
const ACCEPT_TOKENS    = process.env.ACCEPT_TOKENS || 'NATIVE:eth,ERC20:usdt';
const MIN_CONFIRMATIONS= Number(process.env.MIN_CONFIRMATIONS || '0');
const ORDER_TTL_MIN    = Number(process.env.ORDER_TTL_MIN || '15');

const Orders = new Map();
const ok = (res, data) => res.json(data);
const nowSec = () => Math.floor(Date.now() / 1000);

const app = express();

app.post('/webhook/alchemy', express.raw({ type: '*/*' }), (req, res) => {
  try {
    const sig = req.get('x-alchemy-signature') || '';
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body);
    const digest = crypto.createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex');
    const matches = (sig === digest || sig === `sha256=${digest}`);
    if (!matches) return res.status(401).send('invalid signature');

    const payload = JSON.parse(raw.toString('utf8'));
    const evt = payload?.event || {};
    const acts = evt.activity || evt.activities || [];
    for (const a of acts) {
      const to   = (a?.toAddress || a?.to || '').toLowerCase();
      const confs= Number(a?.confirmations ?? 0);
      const txHash = a?.hash || a?.txHash || a?.transactionHash || '';
      const amount = Number(a?.value ?? a?.amount ?? 0) / Math.pow(10, a?.decimals ?? 6);

      if (to===RECEIVING_ADDR && confs>=MIN_CONFIRMATIONS && amount>0) {
        const pending=[...Orders.values()].filter(o=>o.status==='pending').sort((a,b)=>b.createdAt-a.createdAt)[0];
        if(pending){
          pending.status='paid';
          pending.txHash=txHash;
          pending.paidAt=nowSec();
        }
      }
    }
    return res.status(200).send('ok');
  } catch (err) {
    console.error(err);
    return res.status(500).send('error');
  }
});

app.use(express.json());
app.use(cors({ origin: true, credentials: true }));

app.post('/orders',(req,res)=>{
  const {id,asset,amount}=req.body||{};
  if(!id) return res.status(400).json({error:'id required'});
  const o={id,asset,amount,status:'pending',createdAt:nowSec(),expiresAt:nowSec()+ORDER_TTL_MIN*60};
  Orders.set(o.id,o); return ok(res,o);
});
app.get('/orders/:id',(req,res)=>{
  const o=Orders.get(req.params.id); if(!o) return res.status(404).json({error:'not found'});
  return ok(res,o);
});
app.post('/orders/:id/confirm',(req,res)=>{
  const o=Orders.get(req.params.id); if(!o) return res.status(404).json({error:'not found'});
  o.status='paid'; o.paidAt=nowSec(); return ok(res,o);
});
app.listen(PORT,()=>console.log('listening on',PORT));
