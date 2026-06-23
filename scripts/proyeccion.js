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

// Retorno anual esperado de largo plazo, por clase de activo (honesto, sin sobre-prometer).
const BONOS = new Set(['BND', 'AGG', 'BNDX', 'VGIT', 'VGSH', 'TLT', 'VCIT']);
const ORO = new Set(['GLDM', 'GLD', 'IAU', 'SGOL']);
const INTL = new Set(['VXUS', 'VEA', 'VWO', 'VEU', 'IEFA', 'IEMG']);
const EQ_BROAD = new Set(['VOO', 'VTI', 'QQQM', 'QQQ', 'SPY', 'IVV', 'SCHD', 'AVUV', 'VB', 'VUG', 'VNQ']);
function muAnual(sim) {
  const s = (sim || '').toUpperCase();
  if (BONOS.has(s)) return 0.04;
  if (ORO.has(s)) return 0.045;
  if (INTL.has(s)) return 0.07;
  if (EQ_BROAD.has(s)) return 0.09;
  return 0.09; // acciones individuales / moonshots: tratadas como renta variable, sin inflar
}

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

  const cash = efectivo(p);
  let valorHoy = cash;
  let esp30 = cash, var30 = 0, corr30 = 0; // horizonte 30 días (impulso + lecturas)
  let espA = cash, varA = 0, corrA = 0;     // horizonte 1 año (clase de activo)
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
    const sd = stdev(rets);
    const sigma30 = clamp(sd * Math.sqrt(DIAS_BURSATILES), 0.01, 0.7);
    const sigmaA = clamp(sd * Math.sqrt(252), 0.05, 0.9); // volatilidad anualizada
    const n = closes.length;
    const ref = closes[Math.max(0, n - 1 - DIAS_BURSATILES)] || closes[0];
    const tend = ref > 0 ? (closes[n - 1] - ref) / ref : 0;

    // 30 días: usa la lectura abierta o el impulso reciente.
    let mu;
    const lec = abiertas[sim];
    if (lec) {
      const prob = (lec.probabilidad != null) ? lec.probabilidad / 100 : 0.55;
      let conv = (prob - 0.5) * 2;
      if (lec.direccion === 'baja') conv = -conv;
      mu = 0.006 + conv * Math.min(sigma30, 0.18);
    } else {
      mu = 0.006 + clamp(tend * 0.2, -0.04, 0.04);
    }
    mu = clamp(mu, -0.18, 0.18);
    esp30 += valor * (1 + mu);
    var30 += Math.pow(valor * sigma30, 2);
    corr30 += valor * sigma30;

    // 1 año: retorno de largo plazo por clase de activo (el impulso de hoy no dura un año).
    const muA = muAnual(sim);
    espA += valor * (1 + muA);
    varA += Math.pow(valor * sigmaA, 2);
    corrA += valor * sigmaA;
  }
  // Banda con correlación parcial: las acciones especulativas tienden a moverse juntas,
  // así que mezclamos el caso "independiente" (diversificado) con el "todas a la vez".
  // Resultado: el Conservador queda angosto y el Extremo, muy ancho (correcto).
  const RHO = 0.35;
  const banda = (v, c) => Math.sqrt(v * (1 - RHO) + c * c * RHO);
  const pack = (esp, sig) => ({
    valorHoy: +valorHoy.toFixed(2),
    esperado: +esp.toFixed(2),
    pesimista: +Math.max(0, esp - sig).toFixed(2),
    optimista: +(esp + sig).toFixed(2),
    pctEsperado: valorHoy > 0 ? +(((esp - valorHoy) / valorHoy) * 100).toFixed(2) : 0,
  });
  const salida = pack(esp30, banda(var30, corr30));
  salida.anual = pack(espA, banda(varA, corrA)); // proyección a 1 año, mismo formato
  return salida;
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
    console.log('Proyeccion en Upstash ->', Object.entries(salida.portafolios).map(([k, v]) => k + ' 30d $' + v.esperado + ' (' + (v.pctEsperado >= 0 ? '+' : '') + v.pctEsperado + '%) | 1año $' + v.anual.esperado + ' (' + (v.anual.pctEsperado >= 0 ? '+' : '') + v.anual.pctEsperado + '%)').join(' || '));
  } else {
    fs.writeFileSync('proyeccion.json', JSON.stringify(salida, null, 2));
    console.log('Proyeccion en proyeccion.json ->', Object.entries(salida.portafolios).map(([k, v]) => k + ' $' + v.esperado).join(' | '));
  }
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
