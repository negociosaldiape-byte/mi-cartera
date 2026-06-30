// ============================================================
//  operar-auto.js — Robot autónomo diario (doctrina Buffett, reglas claras).
//  Corre en GitHub Actions cada día de mercado. Lee 'cartera' + 'comite' de
//  Upstash, precios de Yahoo, aplica reglas conservadoras, escribe operaciones,
//  registra una "minuta" en Upstash ('minutas') y envía email si hubo acción.
//
//  REGLAS (en orden):
//   1) STOP-LOSS moonshots: si una especulativa cae >=35% bajo su costo prom -> vender todo.
//   2) TRIM concentración: si una posición (salvo VOO) pesa >13% del total -> recortar a 10%.
//   3) DEPLOY en debilidad: si efectivo>=$4k Y el mercado (VOO) cae <=-1.5% hoy ->
//      desplegar $4k repartido en las 3 mejores por puntaje de Comité que estén en rojo hoy.
//      Reserva mínima de caja: $2.000. Máximo un deploy por día.
//   4) Si nada aplica: mantener (la disciplina también es no operar).
//
//    UPSTASH_*, RESEND_API_KEY, ALERT_EMAIL en env.  node scripts/operar-auto.js [--dry]
// ============================================================

const U = process.env.UPSTASH_REDIS_REST_URL, T = process.env.UPSTASH_REDIS_REST_TOKEN;
const RESEND = process.env.RESEND_API_KEY, EMAIL = process.env.ALERT_EMAIL;
const DRY = process.argv.includes('--dry');

const MOONSHOTS = new Set(['OKLO', 'RKLB', 'VRDN', 'RDW', 'CRML', 'SERV', 'RCAT', 'NNE', 'QUBT', 'CAPR', 'WOLF']);
const STOP = 0.35;        // -35% bajo costo promedio
const CAP = 0.13, CAP_OBJ = 0.10;   // recorte de concentración
const RESERVA = 2000, TRANCHE = 4000, DIP = -1.5; // deploy

async function up(cmd) { const r = await fetch(U, { method: 'POST', headers: { Authorization: 'Bearer ' + T, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) }); if (!r.ok) throw new Error('Upstash ' + r.status); return r.json(); }
async function cotiza(sim) {
  const u = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(sim) + '?range=5d&interval=1d';
  const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const j = await r.json(); const res = j.chart && j.chart.result && j.chart.result[0];
  const cl = (res && res.indicators && res.indicators.quote && res.indicators.quote[0].close || []).filter((x) => x != null);
  const pr = (res && res.meta && res.meta.regularMarketPrice) || cl[cl.length - 1];
  const prev = cl.length >= 2 ? cl[cl.length - 2] : (res && res.meta && res.meta.chartPreviousClose) || pr;
  return { precio: pr, diaPct: prev ? (pr / prev - 1) * 100 : 0 };
}
async function email(asunto, html) { if (!RESEND || !EMAIL) return; try { await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + RESEND, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: 'Mi Cartera <onboarding@resend.dev>', to: [EMAIL], subject: asunto, html }) }); } catch (e) { console.error('email', e.message); } }
function hoyISO() { const d = new Date(), z = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()); }

// posiciones con costo promedio
function tenencias(ops) {
  const m = {};
  for (const o of [...ops].sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''))) {
    const s = o.simbolo; m[s] = m[s] || { sh: 0, cost: 0 };
    if (o.tipo === 'venta') { const ac = m[s].sh ? m[s].cost / m[s].sh : 0; m[s].cost -= ac * o.cantidad; m[s].sh -= o.cantidad; }
    else { m[s].sh += o.cantidad; m[s].cost += o.cantidad * o.precio; }
  }
  for (const s in m) { if (m[s].sh < 1e-6) delete m[s]; else m[s].avg = m[s].cost / m[s].sh; }
  return m;
}

(async () => {
  if (!U || !T) { console.error('Faltan UPSTASH_*'); process.exit(1); }
  const c = JSON.parse((await up(['GET', 'cartera'])).result || '{}');
  const p = (c.portafolios || []).find((x) => x.id === (c.activo || 'inversiones')) || (c.portafolios || [])[0];
  if (!p) { console.error('sin portafolio'); process.exit(1); }
  p.operaciones = p.operaciones || [];
  const hoy = hoyISO();
  if (p.autoLast === hoy && !DRY) { console.log('Ya corrí hoy (' + hoy + ').'); return; }

  const comite = JSON.parse((await up(['GET', 'comite'])).result || '{}');
  const score = (s) => (comite.acciones && comite.acciones[s] && comite.acciones[s].compuesto) || 0;

  const ten = tenencias(p.operaciones);
  const simbolos = Object.keys(ten);
  const q = {}; for (const s of simbolos.concat(['VOO'])) { try { q[s] = await cotiza(s); } catch { q[s] = { precio: 0, diaPct: 0 }; } }

  let efvo = p.capitalInicial; for (const o of p.operaciones) { const mt = o.cantidad * o.precio; efvo += (o.tipo === 'venta' ? mt - (o.comision || 0) : -(mt + (o.comision || 0))); }
  let valorPos = 0; for (const s of simbolos) valorPos += ten[s].sh * (q[s].precio || 0);
  const total = efvo + valorPos;

  const fecha = new Date().toISOString();
  const mk = (i) => 'au' + Date.now() + '-' + i; let k = 0;
  const acciones = [], nuevas = [];
  const vender = (s, sh, pr, motivo) => { nuevas.push({ id: mk(k++), simbolo: s, tipo: 'venta', cantidad: sh, precio: pr, comision: 0, fecha, nota: 'auto: ' + motivo }); acciones.push(`VENTA ${s} ${sh.toFixed(3)} @ ${pr.toFixed(2)} — ${motivo}`); };
  const comprar = (s, usd, pr, motivo) => { const sh = usd / pr; nuevas.push({ id: mk(k++), simbolo: s, tipo: 'compra', cantidad: sh, precio: pr, comision: 0, fecha, nota: 'auto: ' + motivo }); acciones.push(`COMPRA ${s} $${usd.toFixed(0)} @ ${pr.toFixed(2)} — ${motivo}`); return usd; };

  // 1) STOP-LOSS moonshots
  for (const s of simbolos) {
    if (!MOONSHOTS.has(s)) continue; const pr = q[s].precio; if (!pr) continue;
    if (pr <= ten[s].avg * (1 - STOP)) { vender(s, ten[s].sh, pr, `stop-loss −35% (entró ~${ten[s].avg.toFixed(2)})`); efvo += ten[s].sh * pr; }
  }
  // 2) TRIM concentración (no VOO)
  for (const s of simbolos) {
    if (s === 'VOO' || nuevas.find((o) => o.simbolo === s)) continue; const pr = q[s].precio; if (!pr) continue;
    const val = ten[s].sh * pr; if (val > CAP * total) { const objetivo = CAP_OBJ * total; const sh = (val - objetivo) / pr; vender(s, sh, pr, `recorte concentración a 10% (pesaba ${(val / total * 100).toFixed(1)}%)`); efvo += sh * pr; }
  }
  // 3) DEPLOY en debilidad
  const mkt = q['VOO'] ? q['VOO'].diaPct : 0;
  if (efvo - TRANCHE >= RESERVA && mkt <= DIP) {
    const candidatos = simbolos.filter((s) => s !== 'VOO' && !MOONSHOTS.has(s) && q[s].precio && q[s].diaPct < 0)
      .sort((a, b) => score(b) - score(a)).slice(0, 3);
    if (candidatos.length) { const cada = TRANCHE / candidatos.length; for (const s of candidatos) { efvo -= comprar(s, cada, q[s].precio, `deploy en debilidad (mercado ${mkt.toFixed(1)}%, Comité ${score(s)})`); } }
  }

  // Registrar
  const minuta = { fecha: hoy, ts: fecha, valorTotal: Math.round(total), efectivo: Math.round(efvo), gpPct: +(((total) / p.capitalInicial - 1) * 100).toFixed(2), acciones, mercadoVOO: +mkt.toFixed(2) };
  if (!DRY) {
    p.operaciones.push(...nuevas);
    p.autoLast = hoy;
    p.minutas = Array.isArray(p.minutas) ? p.minutas : [];
    p.minutas.unshift(minuta); p.minutas = p.minutas.slice(0, 60);
    await up(['SET', 'cartera', JSON.stringify(c)]);
    await up(['SET', 'minutas', JSON.stringify({ generado: fecha, ultima: minuta, historial: p.minutas })]);
  }

  console.log('MINUTA', JSON.stringify(minuta, null, 2));
  if (acciones.length) {
    const html = `<h2>🐺 Minuta automática — ${hoy}</h2><p>Valor total: <b>$${minuta.valorTotal.toLocaleString()}</b> (${minuta.gpPct}%) · caja $${minuta.efectivo.toLocaleString()} · mercado ${minuta.mercadoVOO}%</p><ul>${acciones.map((a) => '<li>' + a + '</li>').join('')}</ul><p style="color:#888">Doctrina Buffett en reglas. Análisis, no asesoría licenciada.</p>`;
    if (!DRY) await email(`🐺 Operé hoy: ${acciones.length} movimiento(s) — $${minuta.valorTotal.toLocaleString()}`, html);
  } else { console.log('Sin acciones hoy (mantener).'); }
})().catch((e) => { console.error(e); process.exit(1); });
