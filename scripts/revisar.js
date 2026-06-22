// ============================================================
//  revisar.js — Robot de alertas (corre en GitHub Actions, gratis)
//  Revisa tu cartera y, si pasa algo relevante, te manda un email.
// ============================================================

const U = process.env.UPSTASH_REDIS_REST_URL;
const T = process.env.UPSTASH_REDIS_REST_TOKEN;
const RESEND = process.env.RESEND_API_KEY;
const EMAIL = process.env.ALERT_EMAIL;
const UMBRAL = 6; // % de movimiento diario para avisar

async function upstash(cmd) {
  const r = await fetch(U, { method: 'POST', headers: { Authorization: 'Bearer ' + T, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) });
  if (!r.ok) throw new Error('Upstash ' + r.status);
  return r.json();
}
async function precio(sim) {
  try {
    const u = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(sim) + '?interval=1d&range=1d';
    const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const j = await r.json();
    const m = j.chart.result[0].meta;
    return { precio: m.regularMarketPrice, prev: (typeof m.chartPreviousClose === 'number' ? m.chartPreviousClose : m.previousClose) };
  } catch { return null; }
}
async function enviar(asunto, html) {
  const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + RESEND, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: 'Mi Cartera <onboarding@resend.dev>', to: [EMAIL], subject: asunto, html }) });
  const j = await r.json();
  if (!r.ok) throw new Error('Resend ' + r.status + ' ' + JSON.stringify(j));
  return j;
}
function hoyISO() { const d = new Date(), z = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()); }
function posiciones(ops) {
  const m = {};
  for (const op of ops || []) { const s = (op.simbolo || '').toUpperCase(); if (!s) continue; const c = Number(op.cantidad) || 0; m[s] = (m[s] || 0) + (op.tipo === 'venta' ? -c : c); }
  return Object.keys(m).filter((s) => m[s] > 1e-7);
}

(async () => {
  if (!U || !T || !RESEND || !EMAIL) { console.error('Faltan variables de entorno'); process.exit(1); }
  const cartera = JSON.parse((await upstash(['GET', 'cartera'])).result || '{}');
  const alertas = JSON.parse((await upstash(['GET', 'alertas'])).result || '{}');
  const hoy = hoyISO();
  alertas.moves = alertas.moves || {}; alertas.moves[hoy] = alertas.moves[hoy] || [];
  alertas.preds = alertas.preds || [];
  const eventos = [];

  // 1) Movimientos fuertes del dia
  for (const s of posiciones(cartera.operaciones)) {
    if (alertas.moves[hoy].includes(s)) continue;
    const p = await precio(s);
    if (!p || p.precio == null || !p.prev) continue;
    const pct = ((p.precio - p.prev) / p.prev) * 100;
    if (Math.abs(pct) >= UMBRAL) { eventos.push({ tipo: 'mov', s, pct, precio: p.precio }); alertas.moves[hoy].push(s); }
  }

  // 2) Lecturas cuyo plazo se cumplio
  const ahora = Date.now();
  for (const pr of cartera.predicciones || []) {
    if (alertas.preds.includes(pr.id)) continue;
    if (pr.precioInicial == null || !pr.fechaCreacion) continue;
    const vence = new Date(pr.fechaCreacion + 'T00:00:00').getTime() + (Number(pr.plazoDias) || 0) * 86400000;
    if (ahora < vence) continue;
    const p = await precio(pr.simbolo);
    if (!p || p.precio == null) continue;
    const acerto = (pr.direccion === 'sube') ? (p.precio > pr.precioInicial) : (p.precio < pr.precioInicial);
    eventos.push({ tipo: 'pred', s: pr.simbolo, dir: pr.direccion, acerto, ini: pr.precioInicial, fin: p.precio });
    alertas.preds.push(pr.id);
  }

  if (eventos.length) {
    let html = '<div style="font-family:Arial,sans-serif;max-width:520px"><h2>Novedades en tu cartera</h2>';
    const movs = eventos.filter((e) => e.tipo === 'mov');
    if (movs.length) {
      html += '<h3>Movimientos fuertes hoy</h3><table style="border-collapse:collapse">' + movs.map((e) => '<tr><td style="padding:6px 12px"><b>' + e.s + '</b></td><td style="padding:6px 12px;color:' + (e.pct >= 0 ? '#1a9e75' : '#d8403a') + '">' + (e.pct >= 0 ? '▲' : '▼') + ' ' + e.pct.toFixed(2) + '%</td><td style="padding:6px 12px">$' + e.precio.toFixed(2) + '</td></tr>').join('') + '</table>';
    }
    const preds = eventos.filter((e) => e.tipo === 'pred');
    if (preds.length) {
      html += '<h3>Lecturas que se cumplieron</h3><ul>' + preds.map((e) => '<li><b>' + e.s + '</b> (' + (e.dir === 'sube' ? 'subir' : 'bajar') + '): ' + (e.acerto ? '✅ ACERTÓ' : '❌ falló') + ' — de $' + e.ini.toFixed(2) + ' a $' + e.fin.toFixed(2) + '</li>').join('') + '</ul>';
    }
    html += '<p style="color:#888;font-size:13px">Míralo en tu panel. Análisis, no asesoría financiera.</p></div>';
    await enviar('Novedades en tu cartera (' + eventos.length + ')', html);
    console.log('Email enviado con', eventos.length, 'eventos');
  } else {
    console.log('Sin novedades relevantes');
  }

  await upstash(['SET', 'alertas', JSON.stringify({ moves: { [hoy]: alertas.moves[hoy] }, preds: alertas.preds.slice(-200) })]);
})().catch((e) => { console.error(e); process.exit(1); });
