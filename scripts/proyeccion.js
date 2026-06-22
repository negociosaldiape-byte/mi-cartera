// ============================================================
//  proyeccion.js — Calcula la proyección a 30 días de cada portafolio.
//  Corre en GitHub Actions (cada 2 días) o local. Sin secretos dentro.
//  Modo nube: lee 'cartera' de Upstash y escribe 'proyeccion' en Upstash.
//  Modo local: lee data.json y escribe proyeccion.json.
// ============================================================

const fs = require('fs');
const U = process.env.UPSTASH_REDIS_REST_URL;
const T = process.env.UPSTASH_REDIS_REST_TOKEN;
const NUBE = !!(U && T);
const CAP_DEF = 10000;
const H_DIAS = 30;
const DIAS_BURSATILES = 21; // ~30 días calendario

async function upstash(cmd) {
  const r = await fetch(U, { method: 'POST', headers: { Authorization: 'Bearer ' + T, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) });
  if (!r.ok) throw new Error('Upstash ' + r.status);
  return r.json();
}
async function historia(sim) {
  try {
    const u = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(sim) + '?interval=1d&range=3mo';
    const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const j = await r.json();
    const res = j.chart.result[0];
    const closes = (res.indicators.quote[0].close || []).filter((x) => typeof x === 'number');
    const precio = (typeof res.meta.regularMarketPrice === 'number') ? res.meta.regularMarketPrice : closes[closes.length - 1];
    return { closes, precio };
  } catch { return null; }
}
function stdev(a) {
  if (a.length < 2) return 0;
  const m = a.reduce((s, x) => s + x, 0) / a.length;
  const v = a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1);
  return Math.sqrt(v);
}
function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

function posiciones(ops) {
  const m = {};
  for (const op of ops || []) {
    const s = (op.simbolo || '').toUpperCase(); if (!s) continue;
    const c = Number(op.cantidad) || 0;
    if (!m[s]) m[s] = 0;
    m[s] += (op.tipo === 'venta' ? -c : c);
  }
  return m;
}
function efectivo(p) {
  let cash = (typeof p.capitalInicial === 'number') ? p.capitalInicial : CAP_DEF;
  for (const op of p.operaciones || []) {
    const monto = (Number(op.cantidad) || 0) * (Number(op.precio) || 0);
    const com = Number(op.comision) || 0;
    if (op.tipo === 'venta') cash += monto - com; else cash -= monto + com;
  }
  return cash;
}

async function proyectarPortafolio(p, cache) {
  const pos = posiciones(p.operaciones);
  const abiertas = {};
  for (const pr of p.predicciones || []) if (pr.estado === 'abierta') abiertas[(pr.simbolo || '').toUpperCase()] = pr;

  let valorHoy = efectivo(p), esperado = efectivo(p), varianza = 0;
  for (const sim of Object.keys(pos)) {
    if (pos[sim] <= 1e-7) continue;
    if (cache[sim] === undefined) cache[sim] = await historia(sim);
    const h = cache[sim];
    if (!h || !h.precio) continue;
    const valor = pos[sim] * h.precio;
    valorHoy += valor;

    const closes = h.closes;
    const rets = [];
    for (let i = 1; i < closes.length; i++) if (closes[i - 1] > 0) rets.push((closes[i] - closes[i - 1]) / closes[i - 1]);
    const sigma30 = clamp(stdev(rets) * Math.sqrt(DIAS_BURSATILES), 0.01, 0.5);
    const n = closes.length;
    const ref = closes[Math.max(0, n - 1 - DIAS_BURSATILES)] || closes[0];
    const tend = ref > 0 ? (closes[n - 1] - ref) / ref : 0;

    let mu;
    const lec = abiertas[sim];
    if (lec) {
      const prob = (lec.probabilidad != null) ? lec.probabilidad / 100 : 0.55;
      let conv = (prob - 0.5) * 2;
      if (lec.direccion === 'baja') conv = -conv;
      mu = 0.005 + conv * Math.min(sigma30, 0.15);
    } else {
      mu = 0.005 + clamp(tend * 0.2, -0.04, 0.04);
    }
    mu = clamp(mu, -0.18, 0.18);

    esperado += valor * (1 + mu);
    varianza += Math.pow(valor * sigma30, 2);
  }
  const sigmaPort = Math.sqrt(varianza);
  return {
    valorHoy: +valorHoy.toFixed(2),
    esperado: +esperado.toFixed(2),
    pesimista: +(esperado - sigmaPort).toFixed(2),
    optimista: +(esperado + sigmaPort).toFixed(2),
    pctEsperado: valorHoy > 0 ? +(((esperado - valorHoy) / valorHoy) * 100).toFixed(2) : 0,
  };
}

(async () => {
  let cartera;
  if (NUBE) cartera = JSON.parse((await upstash(['GET', 'cartera'])).result || '{}');
  else cartera = JSON.parse(fs.readFileSync('data.json', 'utf8'));

  const portafolios = (Array.isArray(cartera.portafolios) && cartera.portafolios.length)
    ? cartera.portafolios
    : [{ id: 'agresivo', nombre: 'Agresivo', capitalInicial: CAP_DEF, operaciones: cartera.operaciones || [], predicciones: cartera.predicciones || [] }];

  const cache = {};
  const salida = { generado: new Date().toISOString(), horizonteDias: H_DIAS, portafolios: {} };
  for (const p of portafolios) salida.portafolios[p.id] = await proyectarPortafolio(p, cache);

  if (NUBE) {
    await upstash(['SET', 'proyeccion', JSON.stringify(salida)]);
    console.log('Proyeccion en Upstash ->', Object.entries(salida.portafolios).map(([k, v]) => k + ' $' + v.esperado + ' (' + (v.pctEsperado >= 0 ? '+' : '') + v.pctEsperado + '%)').join(' | '));
  } else {
    fs.writeFileSync('proyeccion.json', JSON.stringify(salida, null, 2));
    console.log('Proyeccion en proyeccion.json ->', Object.entries(salida.portafolios).map(([k, v]) => k + ' $' + v.esperado).join(' | '));
  }
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
