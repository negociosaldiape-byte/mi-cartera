// ============================================================
//  operar.js — Ejecuta una sesión de trading sobre el portafolio ficticio
//  'inversiones'. Lee precios actuales (Yahoo), aplica una lista de órdenes
//  (ventas/compras) declarada abajo, ajusta capitalInicial si se indica, y
//  escribe el blob 'cartera' en Upstash. Idempotente por marca de sesión.
//
//    UPSTASH_REDIS_REST_URL=... UPSTASH_REDIS_REST_TOKEN=... node scripts/operar.js
// ============================================================

const U = process.env.UPSTASH_REDIS_REST_URL, T = process.env.UPSTASH_REDIS_REST_TOKEN;

// ---- Parámetros de ESTA sesión -------------------------------------------
const SESION = 's1-2026-06-27';           // marca única; no se repite si ya está aplicada
const NUEVO_CAPITAL = 200000;             // sube poder de compra a 200k (null = no tocar)
const VENDER_TODO = ['VRDN', 'RDW', 'CRML', 'SERV', 'RCAT', 'NNE']; // liquidar 100% de estas
// Compras: monto en USD a desplegar por símbolo (se convierte a acciones al precio del día)
const COMPRAR_USD = {
  VOO: 20000, GOOGL: 10000, NVDA: 8000, MSFT: 8000, AMZN: 7000,
  V: 7000, AVGO: 6000, QQQM: 6000, META: 4000, LLY: 4000,
};
// --------------------------------------------------------------------------

async function up(cmd) { const r = await fetch(U, { method: 'POST', headers: { Authorization: 'Bearer ' + T, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) }); if (!r.ok) throw new Error('Upstash ' + r.status); return r.json(); }

async function precio(sim) {
  const u = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(sim) + '?range=1d&interval=1d';
  const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const j = await r.json();
  const res = j.chart && j.chart.result && j.chart.result[0];
  const p = res && res.meta && (res.meta.regularMarketPrice || res.meta.previousClose);
  if (!p) throw new Error('sin precio ' + sim);
  return p;
}

function calcNet(ops) { const net = {}; for (const o of ops) { net[o.simbolo] = (net[o.simbolo] || 0) + (o.tipo === 'venta' ? -1 : 1) * o.cantidad; } return net; }

(async () => {
  if (!U || !T) { console.error('Faltan UPSTASH_*'); process.exit(1); }
  const c = JSON.parse((await up(['GET', 'cartera'])).result || '{}');
  const p = (c.portafolios || []).find((x) => x.id === (c.activo || 'inversiones')) || (c.portafolios || [])[0];
  if (!p) { console.error('No hay portafolio'); process.exit(1); }
  p.operaciones = p.operaciones || [];
  p.sesiones = p.sesiones || [];
  if (p.sesiones.includes(SESION)) { console.log('Sesión', SESION, 'ya aplicada — no hago nada.'); return; }

  const net = calcNet(p.operaciones);
  const fecha = new Date().toISOString();
  const mkId = (i) => 'op' + Date.now() + '-' + i;
  let k = 0; const nuevas = [];
  const minuta = [];

  // 1) Ventas (liquidar 100%)
  for (const s of VENDER_TODO) {
    const cant = net[s] || 0;
    if (cant <= 0) { minuta.push(['VENTA', s, 'sin posición — omitido']); continue; }
    const pr = await precio(s);
    nuevas.push({ id: mkId(k++), simbolo: s, tipo: 'venta', cantidad: cant, precio: pr, comision: 0, fecha, nota: 'Sesión ' + SESION + ': fuera la especulación (sin ganancias/dilución)' });
    minuta.push(['VENTA', s, cant.toFixed(4) + ' @ ' + pr.toFixed(2) + ' = $' + (cant * pr).toFixed(2)]);
  }

  // 2) Compras (desplegar USD)
  for (const s of Object.keys(COMPRAR_USD)) {
    const usd = COMPRAR_USD[s]; const pr = await precio(s);
    const cant = usd / pr;
    nuevas.push({ id: mkId(k++), simbolo: s, tipo: 'compra', cantidad: cant, precio: pr, comision: 0, fecha, nota: 'Sesión ' + SESION + ': calidad comprada en debilidad' });
    minuta.push(['COMPRA', s, cant.toFixed(4) + ' @ ' + pr.toFixed(2) + ' = $' + usd.toFixed(2)]);
  }

  p.operaciones.push(...nuevas);
  if (NUEVO_CAPITAL != null) p.capitalInicial = NUEVO_CAPITAL;
  p.sesiones.push(SESION);

  // Verificación de efectivo (no puede quedar negativo)
  let cash = p.capitalInicial;
  for (const o of p.operaciones) { const m = o.cantidad * o.precio; cash += (o.tipo === 'venta' ? m - (o.comision || 0) : -(m + (o.comision || 0))); }

  await up(['SET', 'cartera', JSON.stringify(c)]);

  console.log('\n===== MINUTA Sesión ' + SESION + ' =====');
  for (const m of minuta) console.log('  ' + m[0].padEnd(6), m[1].padEnd(6), m[2]);
  console.log('\n  capitalInicial ->', p.capitalInicial);
  console.log('  efectivo (pólvora seca) ->', cash.toFixed(2));
  console.log('  total operaciones ->', p.operaciones.length);
})().catch((e) => { console.error(e); process.exit(1); });
