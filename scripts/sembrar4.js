// ============================================================
//  sembrar4.js — Siembra el 4º portafolio "Extremo" (volatilidad extrema).
//  7 moonshots a partes iguales ($10k / 7). Preserva los otros portafolios.
//  Idempotente (reescribe 'extremo'). Lee Upstash de variables de entorno.
//    UPSTASH_REDIS_REST_URL=... UPSTASH_REDIS_REST_TOKEN=... node scripts/sembrar4.js
// ============================================================

const U = process.env.UPSTASH_REDIS_REST_URL;
const T = process.env.UPSTASH_REDIS_REST_TOKEN;
const CAP = 10000;
const TICKERS = ['VRDN', 'CAPR', 'QUBT', 'CRML', 'RDW', 'SERV', 'WOLF'];
const hoy = (() => { const d = new Date(), z = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()); })();

async function upstash(cmd) {
  const r = await fetch(U, { method: 'POST', headers: { Authorization: 'Bearer ' + T, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) });
  if (!r.ok) throw new Error('Upstash ' + r.status);
  return r.json();
}
async function precio(sim) {
  const u = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(sim) + '?interval=1d&range=1d';
  const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const j = await r.json();
  const px = j.chart.result[0].meta.regularMarketPrice;
  if (typeof px !== 'number') throw new Error('Sin precio para ' + sim);
  return px;
}
function nuevoId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

(async () => {
  if (!U || !T) { console.error('Faltan UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN'); process.exit(1); }
  const blob = JSON.parse((await upstash(['GET', 'cartera'])).result || '{}');
  if (!Array.isArray(blob.portafolios)) { console.error('Se esperaba el formato multi-portafolio (version 2). Aborta.'); process.exit(1); }

  const monto = CAP / TICKERS.length;
  const ops = [];
  for (const s of TICKERS) {
    const px = await precio(s);
    ops.push({ id: nuevoId(), simbolo: s, tipo: 'compra', cantidad: monto / px, precio: px, fecha: hoy, comision: 0, nota: 'siembra inicial' });
  }
  const extremo = { id: 'extremo', nombre: 'Extremo', riesgo: 10, capitalInicial: CAP, operaciones: ops, predicciones: [], snapshots: [] };

  blob.portafolios = blob.portafolios.filter((p) => p.id !== 'extremo');
  blob.portafolios.push(extremo);
  blob.version = 2;
  blob.activo = blob.activo || 'agresivo';

  await upstash(['SET', 'cartera', JSON.stringify(blob)]);
  console.log('Sembrado OK -> portafolios:', blob.portafolios.map((p) => p.id).join(', '), '| extremo:', ops.map((o) => o.simbolo).join(','));
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
