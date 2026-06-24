// ============================================================
//  comite.js — Motor de NÚMEROS de "Mi Comité" (corre en GitHub Actions, gratis).
//  Para cada acción de la cartera calcula 4 analistas cuantitativos desde Yahoo
//  (Valuación, Riesgo, Técnico, Dividendos) y los fusiona en la clave Upstash
//  'comite' SIN pisar las opiniones de Claude (moat/macro/catalizadores/director).
//  Sin secretos dentro: lee Upstash de variables de entorno.
//    UPSTASH_REDIS_REST_URL=... UPSTASH_REDIS_REST_TOKEN=... node scripts/comite.js
// ============================================================

const U = process.env.UPSTASH_REDIS_REST_URL;
const T = process.env.UPSTASH_REDIS_REST_TOKEN;

async function upstash(cmd) {
  const r = await fetch(U, { method: 'POST', headers: { Authorization: 'Bearer ' + T, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) });
  if (!r.ok) throw new Error('Upstash ' + r.status);
  return r.json();
}
function posiciones(ops) {
  const m = {};
  for (const op of ops || []) { const s = (op.simbolo || '').toUpperCase(); if (!s) continue; const c = Number(op.cantidad) || 0; m[s] = (m[s] || 0) + (op.tipo === 'venta' ? -c : c); }
  const out = {}; for (const s of Object.keys(m)) if (m[s] > 1e-7) out[s] = m[s];
  return out;
}
async function chart(sim) {
  try {
    const u = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(sim) + '?interval=1d&range=1y';
    const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const res = (await r.json()).chart.result[0];
    const closes = (res.indicators.quote[0].close || []).filter((x) => typeof x === 'number');
    return { closes, precio: (typeof res.meta.regularMarketPrice === 'number') ? res.meta.regularMarketPrice : closes[closes.length - 1] };
  } catch { return null; }
}
async function fundamentals(sim) {
  const mods = 'price,summaryDetail,defaultKeyStatistics,financialData,calendarEvents';
  const u = 'https://query1.finance.yahoo.com/v10/finance/quoteSummary/' + encodeURIComponent(sim) + '?modules=' + mods;
  try {
    const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const j = await r.json();
    return (j.quoteSummary && j.quoteSummary.result) ? j.quoteSummary.result[0] : null;
  } catch { return null; }
}
const val = (o) => (o && typeof o.raw === 'number' ? o.raw : null); // Yahoo envuelve números en {raw,fmt}

function stdev(a) { if (a.length < 2) return 0; const m = a.reduce((s, x) => s + x, 0) / a.length; return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1)); }
function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
function sma(c, n) { if (c.length < n) return null; return c.slice(-n).reduce((s, x) => s + x, 0) / n; }
function interp(x, pts) { for (let i = 1; i < pts.length; i++) { if (x <= pts[i][0]) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0 || 1); } } return pts[pts.length - 1][1]; }
const senalDe = (p, hi, lo) => (p >= (hi || 60) ? 'positiva' : (p >= (lo || 40) ? 'neutra' : 'negativa'));

function analistaRiesgo(closes, f, esEtf) {
  const rets = []; for (let i = 1; i < closes.length; i++) if (closes[i - 1] > 0) rets.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  const vol = stdev(rets) * Math.sqrt(252);
  let pico = closes[0], maxDD = 0; for (const c of closes) { if (c > pico) pico = c; const dd = (pico - c) / pico; if (dd > maxDD) maxDD = dd; }
  const beta = val(f && f.summaryDetail && f.summaryDetail.beta) ?? val(f && f.defaultKeyStatistics && f.defaultKeyStatistics.beta);
  const d2e = esEtf ? null : val(f && f.financialData && f.financialData.debtToEquity);
  const pen = clamp((vol - 0.2) * 150, 0, 45) + clamp(((beta ?? 1) - 1) * 25, 0, 20) + clamp((maxDD - 0.2) * 100, 0, 25) + clamp(((d2e ?? 0) - 100) / 20, 0, 15);
  const puntaje = Math.round(clamp(100 - pen, 5, 95));
  const razones = ['Volatilidad anual ~' + Math.round(vol * 100) + '%', 'Peor caída del año ~' + Math.round(maxDD * 100) + '%'];
  if (beta != null) razones.push('Beta ' + beta.toFixed(2) + (beta > 1.2 ? ' (más nervioso que el mercado)' : ''));
  return { puntaje, senal: senalDe(puntaje), veredicto: puntaje >= 60 ? 'Riesgo manejable' : (puntaje >= 40 ? 'Riesgo medio' : 'Riesgo alto / volátil'), razones, fuente: 'datos' };
}
function analistaTecnico(closes) {
  const last = closes[closes.length - 1], s50 = sma(closes, 50), s200 = sma(closes, 200);
  const i3 = Math.max(0, closes.length - 63); const mom = closes[i3] > 0 ? (last - closes[i3]) / closes[i3] : 0;
  let p = 30; if (s50 && last > s50) p += 20; if (s200 && last > s200) p += 20; if (s50 && s200 && s50 > s200) p += 15; p += clamp(mom * 100, -20, 20);
  const puntaje = Math.round(clamp(p, 5, 95));
  const razones = [(s200 && last > s200 ? 'Sobre su media de 200 días (tendencia de fondo alcista)' : 'Bajo su media de 200 días (tendencia de fondo débil)'), 'Momentum 3 meses ' + (mom >= 0 ? '+' : '') + Math.round(mom * 100) + '%'];
  return { puntaje, senal: senalDe(puntaje), veredicto: puntaje >= 60 ? 'Tendencia a favor' : (puntaje >= 40 ? 'Lateral / mixta' : 'Tendencia en contra'), razones, fuente: 'datos' };
}
function analistaValuacion(f, closes, esEtf) {
  if (esEtf) {
    const hi = Math.max(...closes), lo = Math.min(...closes), last = closes[closes.length - 1];
    const posic = hi > lo ? (last - lo) / (hi - lo) : 0.5;
    const puntaje = Math.round(clamp(80 - posic * 45, 20, 85));
    return { puntaje, senal: 'neutra', veredicto: posic > 0.85 ? 'Cerca de máximos del año' : 'Precio razonable en su rango', razones: ['Es un fondo (ETF): se mide por costo y nivel, no por P/E', 'Está en el ' + Math.round(posic * 100) + '% de su rango de 52 semanas'], fuente: 'datos' };
  }
  const pe = val(f && f.summaryDetail && f.summaryDetail.forwardPE) ?? val(f && f.summaryDetail && f.summaryDetail.trailingPE);
  const ps = val(f && f.summaryDetail && f.summaryDetail.priceToSalesTrailing12Months);
  let puntaje, razones;
  if (pe != null && pe > 0) { puntaje = Math.round(clamp(interp(pe, [[10, 85], [15, 78], [25, 55], [40, 35], [60, 22], [100, 15]]), 15, 85)); razones = ['P/E ~' + pe.toFixed(0) + (pe > 35 ? ' (caro)' : (pe < 18 ? ' (barato)' : ' (normal)'))]; if (ps != null) razones.push('P/Ventas ' + ps.toFixed(1)); }
  else if (ps != null) { puntaje = Math.round(clamp(interp(ps, [[1, 80], [3, 60], [6, 42], [10, 30], [20, 18]]), 15, 82)); razones = ['Sin P/E (probablemente aún no es rentable)', 'P/Ventas ' + ps.toFixed(1)]; }
  else { puntaje = 40; razones = ['Sin métricas de valuación disponibles (típico de empresas muy chicas o no rentables)']; }
  return { puntaje, senal: senalDe(puntaje), veredicto: puntaje >= 60 ? 'Atractiva de precio' : (puntaje >= 40 ? 'Precio justo' : 'Cara'), razones, fuente: 'datos' };
}
function analistaDividendos(f, esEtf) {
  const y = val(f && f.summaryDetail && f.summaryDetail.dividendYield);
  const payout = val(f && f.summaryDetail && f.summaryDetail.payoutRatio);
  if (y == null || y === 0) return { puntaje: 15, senal: 'neutra', veredicto: 'Casi no paga dividendos', razones: [esEtf ? 'Este fondo reparte poco o nada' : 'Apuesta de crecimiento, no de ingresos (no reparte casi nada)'], fuente: 'datos' };
  let puntaje = Math.round(clamp(interp(y * 100, [[0, 15], [1.5, 45], [3, 70], [5, 82], [8, 70]]), 15, 85));
  const razones = ['Rinde ' + (y * 100).toFixed(1) + '% al año en dividendos'];
  if (payout != null) { razones.push('Reparte el ' + (payout * 100).toFixed(0) + '% de sus ganancias' + (payout > 0.8 ? ' (ajustado)' : ' (sostenible)')); if (payout > 0.9) puntaje = Math.round(puntaje * 0.85); }
  return { puntaje, senal: puntaje >= 55 ? 'positiva' : 'neutra', veredicto: puntaje >= 55 ? 'Buen pagador' : 'Dividendo modesto', razones, fuente: 'datos' };
}

const PESOS = { moat: 20, valuacion: 18, riesgo: 15, macro: 12, catalizadores: 10, tecnico: 10, dividendos: 8, politicos: 7 };
function compuesto(analistas) {
  let suma = 0, peso = 0;
  for (const k in PESOS) { const a = analistas[k]; if (a && typeof a.puntaje === 'number') { suma += a.puntaje * PESOS[k]; peso += PESOS[k]; } }
  return peso ? Math.round(suma / peso) : null;
}

(async () => {
  if (!U || !T) { console.error('Faltan UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN'); process.exit(1); }
  const blob = JSON.parse((await upstash(['GET', 'cartera'])).result || '{}');
  const ports = Array.isArray(blob.portafolios) ? blob.portafolios : [];
  const simbolos = [...new Set(ports.flatMap((p) => Object.keys(posiciones(p.operaciones))))];
  const prev = JSON.parse((await upstash(['GET', 'comite'])).result || '{}'); prev.acciones = prev.acciones || {};
  const ahora = new Date().toISOString();

  for (const s of simbolos) {
    const c = await chart(s); if (!c || !c.closes.length) continue;
    const f = await fundamentals(s);
    const esEtf = !!(f && f.price && f.price.quoteType === 'ETF');
    const a = prev.acciones[s] || { simbolo: s, analistas: {} };
    a.nombre = (f && f.price && (f.price.shortName || f.price.longName)) || s;
    a.tipoActivo = esEtf ? 'etf' : 'accion'; a.precio = c.precio; a.actualizado = ahora;
    a.analistas = a.analistas || {};
    a.analistas.riesgo = analistaRiesgo(c.closes, f, esEtf);
    a.analistas.tecnico = analistaTecnico(c.closes);
    a.analistas.valuacion = analistaValuacion(f, c.closes, esEtf);
    a.analistas.dividendos = analistaDividendos(f, esEtf);
    if (!a.analistas.politicos) a.analistas.politicos = { estado: 'inactivo', veredicto: 'Sin datos — la fuente pública gratis se cerró; necesita API' };
    a.compuesto = compuesto(a.analistas);
    prev.acciones[s] = a;
  }
  for (const s of Object.keys(prev.acciones)) if (!simbolos.includes(s)) delete prev.acciones[s];
  prev.generado = ahora;
  await upstash(['SET', 'comite', JSON.stringify(prev)]);
  console.log('Comité (números) ->', simbolos.map((s) => s + ':' + (prev.acciones[s] ? prev.acciones[s].compuesto : '-')).join(' '));
})().catch((e) => { console.error(e); process.exit(1); });
