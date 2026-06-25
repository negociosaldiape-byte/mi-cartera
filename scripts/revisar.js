// ============================================================
//  revisar.js — Tus vigilantes (corre en GitHub Actions, gratis)
//  Varios agentes especializados revisan tu cartera. Si pasa algo
//  relevante, te mandan un email. Además dejan su estado en Upstash
//  (clave 'vigilantes') para que el panel los muestre.
// ============================================================

const U = process.env.UPSTASH_REDIS_REST_URL;
const T = process.env.UPSTASH_REDIS_REST_TOKEN;
const RESEND = process.env.RESEND_API_KEY;
const EMAIL = process.env.ALERT_EMAIL;

const UMBRAL_MOV = 6;       // % de movimiento diario de UNA acción para avisar
const UMBRAL_CONC = 30;     // % máximo que debería pesar UNA acción en la cartera
const UMBRAL_CAIDA = -4;    // % de caída de la CARTERA en el día para avisar

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
  const out = {}; for (const s of Object.keys(m)) if (m[s] > 1e-7) out[s] = m[s];
  return out;
}
function efectivo(pf) {
  let cash = (typeof pf.capitalInicial === 'number') ? pf.capitalInicial : 0;
  for (const op of pf.operaciones || []) {
    const monto = (Number(op.cantidad) || 0) * (Number(op.precio) || 0), com = Number(op.comision) || 0;
    if (op.tipo === 'venta') cash += monto - com; else cash -= monto + com;
  }
  return cash;
}

(async () => {
  if (!U || !T || !RESEND || !EMAIL) { console.error('Faltan variables de entorno'); process.exit(1); }
  const blob = JSON.parse((await upstash(['GET', 'cartera'])).result || '{}');
  const portafolios = Array.isArray(blob.portafolios) && blob.portafolios.length
    ? blob.portafolios
    : [{ id: 'agresivo', nombre: 'Agresivo', capitalInicial: 10000, operaciones: blob.operaciones || [], predicciones: blob.predicciones || [] }];

  const alertas = JSON.parse((await upstash(['GET', 'alertas'])).result || '{}');
  const hoy = hoyISO();
  alertas.moves = alertas.moves || {}; alertas.moves[hoy] = alertas.moves[hoy] || [];
  alertas.riesgo = alertas.riesgo || {}; alertas.riesgo[hoy] = alertas.riesgo[hoy] || [];
  alertas.preds = alertas.preds || [];

  // Datos del Vigía de Trump (clave 'trump', escrita por scripts/trump.js)
  const trumpData = JSON.parse((await upstash(['GET', 'trump'])).result || '{}');
  const trumpMenciones = trumpData.menciones || [];
  const ahora24 = Date.now() - 24 * 3600000;
  const trump24h = trumpMenciones.filter(m => new Date(m.fecha).getTime() > ahora24);
  const trumpEnCartera = trump24h.filter(m => m.enMiCartera && m.enMiCartera.length > 0);
  const trumpTickers24h = [...new Set(trump24h.flatMap(m => m.tickers))];

  const eventos = [];

  // Precios (una sola vez por símbolo, compartidos entre vigilantes)
  const simbolos = [...new Set(portafolios.flatMap((pf) => Object.keys(posiciones(pf.operaciones))))];
  const cache = {};
  for (const s of simbolos) cache[s] = await precio(s);

  // ── Vigía de Movimientos: subidas/bajadas fuertes del día ───────────────
  for (const s of simbolos) {
    const p = cache[s];
    if (!p || p.precio == null || !p.prev) continue;
    const pct = ((p.precio - p.prev) / p.prev) * 100;
    if (Math.abs(pct) >= UMBRAL_MOV && !alertas.moves[hoy].includes(s)) {
      eventos.push({ tipo: 'mov', s, pct, precio: p.precio }); alertas.moves[hoy].push(s);
    }
  }

  // ── Vigía de Riesgo: concentración + caída fuerte de la cartera ─────────
  const riesgoHallazgos = []; // para el resumen del panel
  for (const pf of portafolios) {
    const pos = posiciones(pf.operaciones);
    let valorTotal = efectivo(pf), valorPrev = efectivo(pf), cambioDia = 0, mayor = { s: null, valor: 0 };
    for (const s of Object.keys(pos)) {
      const p = cache[s]; if (!p || p.precio == null) continue;
      const valor = pos[s] * p.precio;
      valorTotal += valor;
      if (p.prev) { valorPrev += pos[s] * p.prev; cambioDia += pos[s] * (p.precio - p.prev); }
      if (valor > mayor.valor) mayor = { s, valor };
    }
    if (valorTotal <= 0) continue;
    const pesoMayor = (mayor.valor / valorTotal) * 100;
    const caidaPct = valorPrev > 0 ? (cambioDia / valorPrev) * 100 : 0;
    riesgoHallazgos.push({ port: pf.nombre || pf.id, pesoMayor, mayorSim: mayor.s, caidaPct });

    if (pesoMayor >= UMBRAL_CONC) {
      const clave = 'conc:' + pf.id + ':' + mayor.s;
      if (!alertas.riesgo[hoy].includes(clave)) { eventos.push({ tipo: 'conc', s: mayor.s, peso: pesoMayor, port: pf.nombre || pf.id }); alertas.riesgo[hoy].push(clave); }
    }
    if (caidaPct <= UMBRAL_CAIDA) {
      const clave = 'draw:' + pf.id;
      if (!alertas.riesgo[hoy].includes(clave)) { eventos.push({ tipo: 'draw', pct: caidaPct, port: pf.nombre || pf.id, monto: cambioDia }); alertas.riesgo[hoy].push(clave); }
    }
  }

  // ── Vigía del Marcador: lecturas cuyo plazo se cumplió ──────────────────
  const ahora = Date.now();
  let lecturasAbiertas = 0;
  for (const pf of portafolios) {
    for (const pr of pf.predicciones || []) {
      if (pr.estado === 'abierta' || !pr.estado) lecturasAbiertas++;
      if (alertas.preds.includes(pr.id)) continue;
      if (pr.precioInicial == null || !pr.fechaCreacion) continue;
      const vence = new Date(pr.fechaCreacion + 'T00:00:00').getTime() + (Number(pr.plazoDias) || 0) * 86400000;
      if (ahora < vence) continue;
      const p = cache[(pr.simbolo || '').toUpperCase()] || await precio(pr.simbolo);
      if (!p || p.precio == null) continue;
      const acerto = (pr.direccion === 'sube') ? (p.precio > pr.precioInicial) : (p.precio < pr.precioInicial);
      eventos.push({ tipo: 'pred', s: pr.simbolo, dir: pr.direccion, acerto, ini: pr.precioInicial, fin: p.precio, port: pf.nombre || pf.id });
      alertas.preds.push(pr.id);
    }
  }

  // ── Estado de cada vigilante para el panel ──────────────────────────────
  const movsHoy = eventos.filter((e) => e.tipo === 'mov');
  const concHoy = eventos.filter((e) => e.tipo === 'conc');
  const drawHoy = eventos.filter((e) => e.tipo === 'draw');
  const predHoy = eventos.filter((e) => e.tipo === 'pred');
  const peorRiesgo = riesgoHallazgos.slice().sort((a, b) => a.caidaPct - b.caidaPct)[0];

  const vigilantes = {
    generado: new Date().toISOString(),
    agentes: [
      {
        id: 'movimientos', nombre: 'Vigía de Movimientos', emoji: '📡',
        estado: movsHoy.length ? 'alerta' : 'ok',
        resumen: movsHoy.length
          ? (movsHoy.length + ' movimiento(s) fuerte(s) hoy: ' + movsHoy.map((e) => e.s + ' ' + (e.pct >= 0 ? '▲' : '▼') + Math.abs(e.pct).toFixed(1) + '%').join(', '))
          : ('Sin saltos bruscos hoy. Vigilando ' + simbolos.length + ' acciones (avisa si alguna se mueve ±' + UMBRAL_MOV + '%).'),
      },
      {
        id: 'riesgo', nombre: 'Vigía de Riesgo', emoji: '🛡️',
        estado: (concHoy.length || drawHoy.length) ? 'alerta' : 'ok',
        resumen: (concHoy.length || drawHoy.length)
          ? [concHoy.map((e) => '⚠ ' + e.s + ' pesa ' + e.peso.toFixed(0) + '% de la cartera').join('; '), drawHoy.map((e) => '⚠ caída de ' + e.pct.toFixed(1) + '% en el día').join('; ')].filter(Boolean).join(' · ')
          : (peorRiesgo ? ('Concentración OK (máx ' + peorRiesgo.mayorSim + ' ' + peorRiesgo.pesoMayor.toFixed(0) + '%). Día: ' + (peorRiesgo.caidaPct >= 0 ? '+' : '') + peorRiesgo.caidaPct.toFixed(1) + '%.') : 'Sin posiciones que vigilar.'),
      },
      {
        id: 'marcador', nombre: 'Vigía del Marcador', emoji: '🎯',
        estado: predHoy.length ? 'alerta' : 'ok',
        resumen: predHoy.length
          ? (predHoy.length + ' lectura(s) cumplieron plazo: ' + predHoy.map((e) => e.s + ' ' + (e.acerto ? '✅' : '❌')).join(', '))
          : (lecturasAbiertas + ' lectura(s) abierta(s) en vigilancia. Te aviso cuando alguna cumpla su plazo.'),
      },
      {
        id: 'politicos', nombre: 'Vigía de Trump', emoji: '🇺🇸',
        estado: trumpEnCartera.length ? 'alerta' : 'ok',
        resumen: trumpEnCartera.length
          ? '🚨 Trump mencionó ' + [...new Set(trumpEnCartera.flatMap(m => m.enMiCartera))].join(', ') + ' de tu cartera. Email enviado.'
          : trump24h.length
            ? trump24h.length + ' mención(es) en 24h: ' + trumpTickers24h.slice(0, 6).join(', ')
            : (trumpData.generado
                ? 'Sin menciones de acciones en 24h. Última revisión: ' + new Date(trumpData.generado).toLocaleString('es', { hour: '2-digit', minute: '2-digit' })
                : 'Monitoreando Truth Social, Casa Blanca y noticias. Sin datos aún.'),
        menciones: trump24h.slice(0, 4).map(m => ({ titulo: m.titulo, tickers: m.tickers, impacto: m.impacto, fecha: m.fecha, url: m.url })),
      },
    ],
  };

  // ── Email consolidado (si hay novedades) ────────────────────────────────
  if (eventos.length) {
    let html = '<div style="font-family:Arial,sans-serif;max-width:540px"><h2>🐺 Tus vigilantes encontraron novedades</h2>';
    if (movsHoy.length) html += '<h3>📡 Movimientos fuertes hoy</h3><table style="border-collapse:collapse">' + movsHoy.map((e) => '<tr><td style="padding:6px 12px"><b>' + e.s + '</b></td><td style="padding:6px 12px;color:' + (e.pct >= 0 ? '#1a9e75' : '#d8403a') + '">' + (e.pct >= 0 ? '▲' : '▼') + ' ' + e.pct.toFixed(2) + '%</td><td style="padding:6px 12px">$' + e.precio.toFixed(2) + '</td></tr>').join('') + '</table>';
    if (concHoy.length || drawHoy.length) {
      html += '<h3>🛡️ Riesgo</h3><ul>';
      html += concHoy.map((e) => '<li><b>Concentración:</b> ' + e.s + ' pesa <b>' + e.peso.toFixed(0) + '%</b> de la cartera' + (e.port ? ' [' + e.port + ']' : '') + ' — demasiado en una sola.</li>').join('');
      html += drawHoy.map((e) => '<li><b>Caída del día:</b> la cartera bajó <b>' + e.pct.toFixed(1) + '%</b> ($' + Math.round(e.monto) + ')' + (e.port ? ' [' + e.port + ']' : '') + '. Recuerda: un día rojo es normal, no vendas en pánico.</li>').join('');
      html += '</ul>';
    }
    if (predHoy.length) html += '<h3>🎯 Lecturas que se cumplieron</h3><ul>' + predHoy.map((e) => '<li><b>' + e.s + '</b> (' + (e.dir === 'sube' ? 'subir' : 'bajar') + '): ' + (e.acerto ? '✅ ACERTÓ' : '❌ falló') + ' — de $' + e.ini.toFixed(2) + ' a $' + e.fin.toFixed(2) + (e.port ? ' <i>[' + e.port + ']</i>' : '') + '</li>').join('') + '</ul>';
    html += '<p style="color:#888;font-size:13px">Míralo en tu panel. Análisis, no asesoría financiera.</p></div>';
    await enviar('🐺 Tus vigilantes: ' + eventos.length + ' novedad(es)', html);
    console.log('Email enviado con', eventos.length, 'eventos');
  } else {
    console.log('Sin novedades relevantes');
  }

  await upstash(['SET', 'alertas', JSON.stringify({ moves: { [hoy]: alertas.moves[hoy] }, riesgo: { [hoy]: alertas.riesgo[hoy] }, preds: alertas.preds.slice(-200) })]);
  await upstash(['SET', 'vigilantes', JSON.stringify(vigilantes)]);
  console.log('Vigilantes actualizados:', vigilantes.agentes.map((a) => a.id + '=' + a.estado).join(', '));
})().catch((e) => { console.error(e); process.exit(1); });
