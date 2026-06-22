// ============================================================
//  sembrar3.js — Siembra (una vez) los portafolios Conservador y Balanceado.
//  Preserva el portafolio Agresivo existente. Idempotente: si los nuevos
//  ya existen, los reescribe. Lee Upstash de variables de entorno (sin secretos aqui).
//    UPSTASH_REDIS_REST_URL=... UPSTASH_REDIS_REST_TOKEN=... node scripts/sembrar3.js
// ============================================================

const U = process.env.UPSTASH_REDIS_REST_URL;
const T = process.env.UPSTASH_REDIS_REST_TOKEN;
const CAP = 10000;
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

const PLANES = {
  conservador: { nombre: 'Conservador', riesgo: 2, pesos: [['VOO', 55], ['SCHD', 12], ['SGOV', 10], ['MSFT', 8], ['AAPL', 7], ['JNJ', 5], ['NVDA', 3]] },
  balanceado: { nombre: 'Balanceado', riesgo: 5, pesos: [['VOO', 40], ['SCHD', 12], ['MSFT', 10], ['JPM', 9], ['GE', 8], ['LLY', 8], ['GLD', 8], ['BIL', 3]] },
};

(async () => {
  if (!U || !T) { console.error('Faltan UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN'); process.exit(1); }
  const blob = JSON.parse((await upstash(['GET', 'cartera'])).result || '{}');

  // 1) Asegurar el portafolio Agresivo (migrar formato viejo si hace falta)
  let agresivo;
  if (Array.isArray(blob.portafolios)) agresivo = blob.portafolios.find((p) => p.id === 'agresivo') || blob.portafolios[0];
  if (!agresivo) agresivo = { id: 'agresivo', nombre: 'Agresivo', riesgo: 8.5, capitalInicial: CAP, operaciones: blob.operaciones || [], predicciones: blob.predicciones || [], snapshots: blob.snapshots || [] };
  agresivo.id = 'agresivo';
  agresivo.nombre = agresivo.nombre || 'Agresivo';
  if (typeof agresivo.riesgo !== 'number') agresivo.riesgo = 8.5;
  if (typeof agresivo.capitalInicial !== 'number') agresivo.capitalInicial = CAP;
  agresivo.operaciones = agresivo.operaciones || [];
  agresivo.predicciones = agresivo.predicciones || [];
  agresivo.snapshots = agresivo.snapshots || [];

  // 2) Construir los 2 nuevos con precios en vivo (acciones fraccionarias)
  const nuevos = [];
  for (const [pid, plan] of Object.entries(PLANES)) {
    const ops = [];
    for (const [sim, pct] of plan.pesos) {
      const px = await precio(sim);
      const cant = (CAP * pct / 100) / px;
      ops.push({ id: nuevoId(), simbolo: sim, tipo: 'compra', cantidad: cant, precio: px, fecha: hoy, comision: 0, nota: 'siembra inicial' });
    }
    nuevos.push({ id: pid, nombre: plan.nombre, riesgo: plan.riesgo, capitalInicial: CAP, operaciones: ops, predicciones: [], snapshots: [] });
  }

  // 3) Reconstruir: agresivo + otros (no nuevos) + nuevos
  const idsNuevos = new Set(Object.keys(PLANES));
  const otros = Array.isArray(blob.portafolios) ? blob.portafolios.filter((p) => p.id !== 'agresivo' && !idsNuevos.has(p.id)) : [];
  const salida = { version: 2, activo: 'agresivo', portafolios: [agresivo, ...otros, ...nuevos] };

  await upstash(['SET', 'cartera', JSON.stringify(salida)]);
  console.log('Sembrado OK ->', salida.portafolios.map((p) => p.id + ' (' + (p.operaciones || []).length + ' ops)').join(', '));
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
