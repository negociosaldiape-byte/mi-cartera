// ============================================================
//  app.js — Mi Cartera (corre en el navegador)
// ============================================================

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const COL = { text: '#f1f5fb', muted: '#94a3bd', faint: '#5b6982', green: '#2fd98a', red: '#ff5c6c', accent: '#6c8cff', track: 'rgba(255,255,255,0.08)' };
const PALETA = ['#6c8cff', '#2fd98a', '#f5c451', '#ff5c6c', '#8a7bff', '#00c6a7', '#ff9d5c', '#5bd1ff'];

let MONEDA = 'USD';
let ESTADO = null;
let PORT_ACTIVO = null;
let modoDemo = false;
let ultimoAciertos = -1;
const valoresPrevios = {};
const ocultosSim = new Set();
const ocultosPred = new Set();

// ---------- Formato ----------
function fmtDinero(n) { if (n == null || isNaN(n)) return '—'; try { return new Intl.NumberFormat('es', { style: 'currency', currency: MONEDA, maximumFractionDigits: 2 }).format(n); } catch { return Number(n).toFixed(2) + ' ' + MONEDA; } }
function fmtNum(n) { if (n == null || isNaN(n)) return '—'; return Number(n).toLocaleString('es', { maximumFractionDigits: 4 }); }
function fmtPct(n) { if (n == null || isNaN(n)) return '—'; return (n >= 0 ? '+' : '') + Number(n).toFixed(2) + '%'; }
function clase(n) { if (n == null || isNaN(n)) return ''; return n >= 0 ? 'pos' : 'neg'; }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function hoyISO() { const d = new Date(), z = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()); }

// ---------- Count-up + flash ----------
function animar(el, from, to, fmt) {
  const dur = 900, t0 = performance.now();
  (function frame(t) {
    const p = Math.min(1, (t - t0) / dur);
    const e = 1 - Math.pow(2, -10 * p);
    el.textContent = fmt(from + (to - from) * e);
    if (p < 1) requestAnimationFrame(frame); else el.textContent = fmt(to);
  })(t0);
}
function setNum(el, key, val, fmt) {
  if (!el) return;
  const tenia = key in valoresPrevios;
  const prev = tenia ? valoresPrevios[key] : 0;
  if (val == null) { el.textContent = '—'; valoresPrevios[key] = null; return; }
  if (reducedMotion) el.textContent = fmt(val); else animar(el, (prev == null ? 0 : prev), val, fmt);
  if (tenia && prev != null && Math.abs(val - prev) > 0.005) {
    el.classList.remove('flash-up', 'flash-down'); void el.offsetWidth;
    el.classList.add(val > prev ? 'flash-up' : 'flash-down');
  }
  valoresPrevios[key] = val;
}

// ---------- Carga / orquestación ----------
async function cargar() {
  try {
    const q = PORT_ACTIVO ? ('?portafolio=' + encodeURIComponent(PORT_ACTIVO)) : '';
    const r = await fetch('/api/estado' + q);
    const e = await r.json();
    ESTADO = e; modoDemo = false;
    document.getElementById('bannerDemo').hidden = true;
    pintarTodo(e);
  } catch (err) {
    document.getElementById('infoFuente').textContent = 'No se pudo conectar con el motor. ¿La ventana negra sigue abierta?';
  }
}
function render(e) { if (e) pintarTodo(e); }

function pintarTodo(e) {
  MONEDA = e.moneda || 'USD';
  if (e.portafolio) PORT_ACTIVO = e.portafolio;
  pintarPestanas(e.pestanas, e.portafolio);
  document.getElementById('infoFuente').textContent = modoDemo ? 'Datos de ejemplo' : ('Precios: ' + e.proveedor + ' · ' + e.actualizado);
  pintarHeroe(e.resumen);
  pintarKPIs(e.resumen);
  pintarProyeccion(e.proyeccion);
  pintarVigilantes(e.vigilantes);
  construirArea(e.historico);
  construirDonut(e.posiciones);
  construirAnillo(e.marcador);
  pintarPosiciones(e.posiciones);
  pintarPredicciones(e.predicciones, e.marcador);
  // Confeti al sumar un acierto (solo con datos reales)
  if (!modoDemo && e.marcador) {
    if (ultimoAciertos >= 0 && e.marcador.aciertos > ultimoAciertos) confeti();
    ultimoAciertos = e.marcador.aciertos;
  }
}

// ---------- Pestañas de portafolios ----------
function badgeRiesgo(riesgo) {
  if (riesgo == null) return '';
  const n = Number(riesgo);
  const cls = n <= 3 ? 'r-bajo' : (n <= 6 ? 'r-medio' : 'r-alto');
  return `<span class="pest-riesgo ${cls}">${Number.isInteger(n) ? n : n.toFixed(1)}/10</span>`;
}
function pintarPestanas(pestanas, activo) {
  const cont = document.getElementById('pestanas');
  if (!cont) return;
  if (!pestanas || !pestanas.length) { cont.innerHTML = ''; cont.hidden = true; return; }
  cont.hidden = false;
  cont.innerHTML = pestanas.map((p) => {
    const act = p.id === activo;
    const chip = p.gpTotalPct == null ? '' : `<span class="pest-pyl ${clase(p.gpTotalPct)}">${fmtPct(p.gpTotalPct)}</span>`;
    return `<button class="pestana${act ? ' activa' : ''}" data-port="${esc(p.id)}">
      <span class="pest-top"><span class="pest-nombre">${esc(p.nombre)}</span>${badgeRiesgo(p.riesgo)}</span>
      <span class="pest-bot"><span class="pest-valor">${fmtDinero(p.valorTotal)}</span>${chip}</span>
    </button>`;
  }).join('');
}
function cambiarPortafolio(id) {
  if (modoDemo || !id || id === PORT_ACTIVO) return;
  PORT_ACTIVO = id;
  for (const k in valoresPrevios) delete valoresPrevios[k]; // count-up limpio
  ultimoAciertos = -1; ocultosSim.clear(); ocultosPred.clear();
  window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' });
  cargar();
}
document.getElementById('pestanas').addEventListener('click', (e) => { const b = e.target.closest('.pestana'); if (b) cambiarPortafolio(b.dataset.port); });

// ---------- Héroe ----------
function pintarHeroe(r) {
  const total = r.valorTotal != null ? r.valorTotal : r.valorActual;
  setNum(document.getElementById('heroeValor'), 'hero', total, fmtDinero);
  const pyl = document.getElementById('heroePyl');
  pyl.textContent = r.gpTotal == null ? '—' : ((r.gpTotal >= 0 ? '▲ ' : '▼ ') + fmtDinero(Math.abs(r.gpTotal)));
  pyl.className = 'chip-pyl ' + clase(r.gpTotal);
  const pct = document.getElementById('heroePylPct');
  pct.textContent = fmtPct(r.gpTotalPct); pct.className = 'chip-pct ' + clase(r.gpTotalPct);
  let sub = '';
  if (r.cambioDia != null && Math.abs(r.cambioDia) > 0.005) sub = (r.cambioDia >= 0 ? '▲ ' : '▼ ') + fmtDinero(Math.abs(r.cambioDia)) + ' hoy · ';
  sub += r.capitalInicial ? ('sobre ' + fmtDinero(r.capitalInicial) + ' de capital') : (r.invertido ? ('sobre ' + fmtDinero(r.invertido) + ' invertidos') : '');
  document.getElementById('heroeSub').textContent = sub;
}

// ---------- KPIs ----------
function pintarKPIs(r) {
  const mes = r.gananciaMes || {};
  const mesHTML = mes.disponible
    ? '<div class="valor num" id="kpiMes"></div>'
    : '<div class="valor" style="font-size:1.02rem;color:var(--faint)">Se acumula desde hoy</div>';
  document.getElementById('kpis').innerHTML = `
    <div class="kpi"><div class="etiqueta">Plata invertida <button class="info-i" data-info="Lo que está puesto en acciones ahora mismo (a precio de compra).">i</button></div><div class="valor num" id="kpiInvertido"></div><div class="extra">en posiciones abiertas</div></div>
    <div class="kpi"><div class="etiqueta">Efectivo libre <button class="info-i" data-info="Plata de tu capital que aún no has invertido. Lista para comprar.">i</button></div><div class="valor num" id="kpiEfectivo"></div><div class="extra">sin invertir</div></div>
    <div class="kpi"><div class="etiqueta">Ganancia / Pérdida <button class="info-i" data-info="Tu valor total (acciones + efectivo) comparado con el capital inicial.">i</button></div><div class="valor num" id="kpiPyl"></div><div class="extra num ${clase(r.gpTotalPct)}">${fmtPct(r.gpTotalPct)}</div></div>
    <div class="kpi"><div class="etiqueta">Este mes <button class="info-i" data-info="Cuánto ha cambiado tu valor total este mes. Se calcula con el historial, así que se llena con los días.">i</button></div>${mesHTML}<div class="extra">${r.realizado ? ('Realizado: ' + fmtDinero(r.realizado)) : ''}</div></div>`;
  setNum(document.getElementById('kpiInvertido'), 'inv', r.invertido, fmtDinero);
  setNum(document.getElementById('kpiEfectivo'), 'efe', r.efectivo, fmtDinero);
  const pyl = document.getElementById('kpiPyl'); setNum(pyl, 'pyl', r.gpTotal, fmtDinero); const cpyl = clase(r.gpTotal); if (cpyl) pyl.classList.add(cpyl);
  if (mes.disponible) { const m = document.getElementById('kpiMes'); setNum(m, 'mes', mes.valor, fmtDinero); const cm = clase(mes.valor); if (cm) m.classList.add(cm); }
}

// ---------- Proyección (30 días + 1 año) ----------
// suf = '' para 30 días, 'A' para 1 año. Mismo formato de datos en ambos.
function pintarUnaProy(suf, datos, generado) {
  const sec = document.getElementById('proyeccion' + suf);
  if (!sec) return;
  if (!datos || datos.esperado == null || datos.valorHoy == null) { sec.hidden = true; return; }
  sec.hidden = false;
  const hoy = datos.valorHoy;
  const cambio = (v) => (v - hoy >= 0 ? 'ganas ' : 'pierdes ') + fmtDinero(Math.abs(v - hoy));
  document.getElementById('proyHoy' + suf).innerHTML = 'Hoy: <strong>' + fmtDinero(hoy) + '</strong>';
  setNum(document.getElementById('proyValor' + suf), 'proy' + suf, datos.esperado, fmtDinero);
  const cb = document.getElementById('proyCambio' + suf);
  cb.textContent = cambio(datos.esperado); cb.className = 'proy-prob-cambio ' + clase(datos.esperado - hoy);
  document.getElementById('proyBienValor' + suf).textContent = fmtDinero(datos.optimista);
  const bc = document.getElementById('proyBienCambio' + suf); bc.textContent = cambio(datos.optimista); bc.className = 'proy-esc-cambio ' + clase(datos.optimista - hoy);
  document.getElementById('proyMalValor' + suf).textContent = fmtDinero(datos.pesimista);
  const mc = document.getElementById('proyMalCambio' + suf); mc.textContent = cambio(datos.pesimista); mc.className = 'proy-esc-cambio ' + clase(datos.pesimista - hoy);
  const f = document.getElementById('proyFecha' + suf);
  if (f) f.textContent = generado ? ('Actualizado ' + new Date(generado).toLocaleDateString('es', { day: '2-digit', month: 'short' })) : '';
}
function pintarProyeccion(pr) {
  if (!pr) { ['', 'A'].forEach((s) => { const el = document.getElementById('proyeccion' + s); if (el) el.hidden = true; }); return; }
  pintarUnaProy('', pr, pr.generado);          // 30 días (campos al nivel raíz)
  pintarUnaProy('A', pr.anual, pr.generado);   // 1 año (sub-objeto .anual)
}

// ---------- Vigilantes (agentes) ----------
function pintarVigilantes(v) {
  const sec = document.getElementById('vigilantes');
  if (!sec) return;
  if (!v || !Array.isArray(v.agentes) || !v.agentes.length) { sec.hidden = true; return; }
  sec.hidden = false;
  const dot = (estado) => estado === 'alerta' ? 'alerta' : (estado === 'inactivo' ? 'inactivo' : 'ok');
  const etiq = (estado) => estado === 'alerta' ? 'novedad' : (estado === 'inactivo' ? 'en pausa' : 'todo en orden');
  document.getElementById('vigGrid').innerHTML = v.agentes.map((a) => `
    <div class="vig-card vig-${dot(a.estado)}">
      <div class="vig-top">
        <span class="vig-emoji">${esc(a.emoji || '🐺')}</span>
        <span class="vig-nombre">${esc(a.nombre || '')}</span>
        <span class="vig-estado e-${dot(a.estado)}">${etiq(a.estado)}</span>
      </div>
      <div class="vig-resumen">${esc(a.resumen || '')}</div>
    </div>`).join('');
  const c = document.getElementById('vigCuando');
  if (c) c.textContent = v.generado ? ('Última ronda: ' + new Date(v.generado).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })) : '';
}

// ---------- Gráfico de área (evolución) ----------
function construirArea(historico) {
  const svg = document.getElementById('graficoArea'), vacio = document.getElementById('areaVacio');
  const pts = (historico || []).filter((s) => typeof s.valorTotal === 'number');
  if (pts.length < 5) { svg.innerHTML = ''; vacio.hidden = false; return; }
  vacio.hidden = true;
  const W = 320, H = 120, pad = 8;
  const vals = pts.map((p) => p.valorTotal), min = Math.min(...vals), max = Math.max(...vals), rango = (max - min) || 1;
  const x = (i) => pad + (i / (pts.length - 1)) * (W - 2 * pad);
  const y = (v) => H - pad - ((v - min) / rango) * (H - 2 * pad);
  let d = ''; pts.forEach((p, i) => { d += (i ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(p.valorTotal).toFixed(1) + ' '; });
  const area = d + 'L' + x(pts.length - 1).toFixed(1) + ',' + H + ' L' + x(0).toFixed(1) + ',' + H + ' Z';
  const c = vals[vals.length - 1] >= vals[0] ? COL.green : COL.red;
  svg.innerHTML = `<defs><linearGradient id="gArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c}" stop-opacity="0.35"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></linearGradient></defs>
    <path d="${area}" fill="url(#gArea)"/>
    <path id="areaLinea" d="${d}" fill="none" stroke="${c}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
  const linea = svg.querySelector('#areaLinea');
  if (!reducedMotion) { const len = linea.getTotalLength(); linea.style.strokeDasharray = len; linea.style.strokeDashoffset = len; requestAnimationFrame(() => { linea.style.transition = 'stroke-dashoffset 1.4s cubic-bezier(0.16,1,0.3,1)'; linea.style.strokeDashoffset = 0; }); }
}

// ---------- Donut (reparto) ----------
function construirDonut(posiciones) {
  const svg = document.getElementById('graficoDonut'), vacio = document.getElementById('donutVacio'), ley = document.getElementById('leyendaDonut');
  const con = (posiciones || []).filter((p) => !ocultosSim.has(p.simbolo) && p.valor != null && p.valor > 0).sort((a, b) => b.valor - a.valor);
  if (!con.length) { svg.innerHTML = ''; ley.innerHTML = ''; vacio.hidden = false; return; }
  vacio.hidden = true;
  const total = con.reduce((s, p) => s + p.valor, 0);
  const cx = 70, cy = 70, r = 52, C = 2 * Math.PI * r;
  let acc = 0, circles = '', leyenda = '';
  con.forEach((p, i) => {
    const frac = p.valor / total, color = PALETA[i % PALETA.length], dash = frac * C;
    circles += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="16" stroke-dasharray="${dash.toFixed(2)} ${(C - dash).toFixed(2)}" stroke-dashoffset="${(-acc * C).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"/>`;
    leyenda += `<div class="leyenda-fila"><span class="leyenda-punto" style="background:${color}"></span><span class="leyenda-nombre">${esc(p.simbolo)}</span><span class="leyenda-pct">${(frac * 100).toFixed(1)}%</span></div>`;
    acc += frac;
  });
  svg.innerHTML = circles + `<text x="${cx}" y="${cy - 4}" text-anchor="middle" fill="${COL.text}" font-size="15" font-weight="700" font-family="Bricolage Grotesque, sans-serif">${con.length}</text><text x="${cx}" y="${cy + 12}" text-anchor="middle" fill="${COL.muted}" font-size="9">activos</text>`;
  ley.innerHTML = leyenda;
  if (!reducedMotion) { svg.style.transition = 'none'; svg.style.opacity = '0'; svg.style.transform = 'scale(0.85) rotate(-12deg)'; requestAnimationFrame(() => { svg.style.transition = 'opacity .6s cubic-bezier(0.16,1,0.3,1), transform .6s cubic-bezier(0.16,1,0.3,1)'; svg.style.opacity = '1'; svg.style.transform = 'none'; }); }
}

// ---------- Anillo (marcador) ----------
function construirAnillo(m) {
  const svg = document.getElementById('graficoAnillo'); if (!m) m = { tasa: null, aciertos: 0, total: 0, abiertas: 0 };
  const cx = 70, cy = 70, r = 54, C = 2 * Math.PI * r;
  const tasa = m.tasa, pct = tasa == null ? 0 : tasa / 100;
  const c = tasa == null ? COL.faint : (tasa >= 50 ? COL.green : COL.red);
  svg.innerHTML = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${COL.track}" stroke-width="12"/>
    <circle id="anilloProg" cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${c}" stroke-width="12" stroke-linecap="round" transform="rotate(-90 ${cx} ${cy})" stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="${C.toFixed(2)}"/>
    <text x="${cx}" y="${cy - 1}" text-anchor="middle" fill="${COL.text}" font-size="27" font-weight="800" font-family="Bricolage Grotesque, sans-serif">${tasa == null ? '—' : Math.round(tasa) + '%'}</text>
    <text x="${cx}" y="${cy + 17}" text-anchor="middle" fill="${COL.muted}" font-size="10">aciertos</text>`;
  const prog = svg.querySelector('#anilloProg'), destino = C * (1 - pct);
  if (reducedMotion) prog.setAttribute('stroke-dashoffset', destino.toFixed(2));
  else requestAnimationFrame(() => { prog.style.transition = 'stroke-dashoffset 1.2s cubic-bezier(0.16,1,0.3,1)'; prog.setAttribute('stroke-dashoffset', destino.toFixed(2)); });
  document.getElementById('marcadorChips').innerHTML = `<div class="anillo-detalle"><strong style="color:var(--text)">${m.aciertos}/${m.total}</strong> cerradas con acierto</div><div class="anillo-detalle">${m.abiertas} lectura(s) abierta(s)</div>`;
}

// ---------- Sparkline ----------
function sparkSVG(spark) {
  if (!spark || spark.length < 2) return '<span style="color:var(--faint)">—</span>';
  const W = 78, H = 26, pad = 2, min = Math.min(...spark), max = Math.max(...spark), rango = (max - min) || 1;
  const x = (i) => pad + (i / (spark.length - 1)) * (W - 2 * pad);
  const y = (v) => H - pad - ((v - min) / rango) * (H - 2 * pad);
  let d = ''; spark.forEach((v, i) => { d += (i ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(v).toFixed(1) + ' '; });
  const c = spark[spark.length - 1] >= spark[0] ? COL.green : COL.red;
  return `<svg class="spark" viewBox="0 0 ${W} ${H}"><path d="${d}" fill="none" stroke="${c}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

// ---------- Posiciones ----------
const TRASH = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>';
function pintarPosiciones(posiciones) {
  const cuerpo = document.getElementById('cuerpoPosiciones'), tabla = document.getElementById('tablaPosiciones'), vacio = document.getElementById('vacioPosiciones');
  const pos = (posiciones || []).filter((p) => !ocultosSim.has(p.simbolo));
  if (!pos.length) { tabla.style.display = 'none'; vacio.hidden = false; cuerpo.innerHTML = ''; return; }
  tabla.style.display = ''; vacio.hidden = true;
  cuerpo.innerHTML = pos.map((p) => `
    <tr class="fila-clic" data-sim="${esc(p.simbolo)}">
      <td><div class="activo-cell"><span class="activo-sim">${esc(p.simbolo)}</span><span class="ver-grafico">ver gráfico ↗</span></div></td>
      <td>${sparkSVG(p.spark)}</td>
      <td class="der num">${fmtNum(p.cantidad)}</td>
      <td class="der num">${fmtDinero(p.costoPromedio)}</td>
      <td class="der num">${p.precioActual != null ? fmtDinero(p.precioActual) : '<span class="precio-error">sin precio</span>'}</td>
      <td class="der num">${fmtDinero(p.valor)}</td>
      <td class="der num ${clase(p.gp)}">${fmtDinero(p.gp)} <small>${p.gpPct != null ? '(' + fmtPct(p.gpPct) + ')' : ''}</small></td>
      <td><button class="fila-borrar" data-borrar="pos" data-sim="${esc(p.simbolo)}" aria-label="Eliminar ${esc(p.simbolo)}">${TRASH}</button></td>
    </tr>`).join('');
}

// ---------- Predicciones ----------
function etiquetaEstado(p) { return p.estado === 'acertada' ? '✓ Acertada' : p.estado === 'fallada' ? '✗ Fallada' : 'Abierta'; }
function pintarPredicciones(preds, marcador) {
  const lista = document.getElementById('listaPredicciones'), vacio = document.getElementById('vacioPredicciones');
  const ps = (preds || []).filter((p) => !ocultosPred.has(p.id));
  if (!ps.length) { lista.innerHTML = ''; vacio.hidden = false; return; }
  vacio.hidden = true;
  lista.innerHTML = ps.map((p) => `
    <li class="pred-item">
      <div class="pred-dir ${p.direccion}">${p.direccion === 'sube' ? '▲' : '▼'}</div>
      <div class="pred-info">
        <div class="pred-sim">${esc(p.simbolo)}${p.autor === 'claude' ? ' <span class="pred-autor">· por Claude</span>' : ''}</div>
        <div class="pred-meta">${p.probabilidad != null ? p.probabilidad + '% · ' : ''}plazo ${p.plazoDias}d · desde ${esc(p.fechaCreacion)} · entró a ${fmtDinero(p.precioInicial)}${p.razon ? (' · ' + esc(p.razon)) : ''}</div>
      </div>
      <span class="pred-estado estado-${p.estado}">${etiquetaEstado(p)}</span>
      <button class="fila-borrar" data-borrar="pred" data-id="${esc(p.id)}" style="opacity:.5" aria-label="Eliminar lectura">${TRASH}</button>
    </li>`).join('');
}

// ---------- Confeti ----------
function confeti() {
  if (reducedMotion) return;
  const cv = document.getElementById('confeti'), ctx = cv.getContext('2d');
  cv.width = innerWidth; cv.height = innerHeight;
  const parts = [];
  for (let i = 0; i < 150; i++) parts.push({ x: innerWidth / 2 + (Math.random() - 0.5) * 240, y: innerHeight / 3, vx: (Math.random() - 0.5) * 10, vy: Math.random() * -13 - 4, g: 0.4 + Math.random() * 0.3, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, s: 5 + Math.random() * 7, c: PALETA[i % PALETA.length] });
  let f = 0;
  (function paso() {
    f++; ctx.clearRect(0, 0, cv.width, cv.height);
    parts.forEach((p) => { p.vy += p.g; p.x += p.vx; p.y += p.vy; p.rot += p.vr; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6); ctx.restore(); });
    if (f < 160) requestAnimationFrame(paso); else ctx.clearRect(0, 0, cv.width, cv.height);
  })();
}

// ---------- Autocompletar ----------
const buscarInput = document.getElementById('buscarSimbolo'), acUl = document.getElementById('resultadosBusqueda');
let acTimer, acItems = [], acIdx = -1;
buscarInput.addEventListener('input', () => { clearTimeout(acTimer); const q = buscarInput.value.trim(); if (q.length < 1) { acUl.hidden = true; return; } acTimer = setTimeout(() => buscar(q), 250); });
async function buscar(q) { try { const r = await fetch('/api/buscar?q=' + encodeURIComponent(q)); const j = await r.json(); acItems = j.resultados || []; pintarAC(); } catch { acUl.hidden = true; } }
function pintarAC() { if (!acItems.length) { acUl.hidden = true; return; } acIdx = -1; acUl.innerHTML = acItems.map((x, i) => `<li data-i="${i}"><span><span class="ac-sim">${esc(x.simbolo)}</span> <span class="ac-nom">${esc(x.nombre)}</span></span><span class="ac-bolsa">${esc(x.bolsa)}</span></li>`).join(''); acUl.hidden = false; }
acUl.addEventListener('click', (e) => { const li = e.target.closest('li'); if (li) elegirAC(+li.dataset.i); });
buscarInput.addEventListener('keydown', (e) => {
  if (acUl.hidden) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); acIdx = Math.min(acIdx + 1, acItems.length - 1); marcarAC(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); acIdx = Math.max(acIdx - 1, 0); marcarAC(); }
  else if (e.key === 'Enter' && acIdx >= 0) { e.preventDefault(); elegirAC(acIdx); }
  else if (e.key === 'Escape') acUl.hidden = true;
});
function marcarAC() { [...acUl.children].forEach((li, i) => li.classList.toggle('activa', i === acIdx)); }
async function elegirAC(i) {
  const x = acItems[i]; if (!x) return;
  buscarInput.value = x.simbolo; acUl.hidden = true;
  const hint = document.getElementById('hintPrecio'); hint.textContent = 'buscando precio…';
  try { const r = await fetch('/api/precio?simbolo=' + encodeURIComponent(x.simbolo)); const j = await r.json(); if (j.precio != null) { document.querySelector('#formOperacion input[name=precio]').value = j.precio; hint.textContent = 'precio de ahora ✓'; } else hint.textContent = ''; } catch { hint.textContent = ''; }
}

// ---------- Modal ----------
const modal = document.getElementById('modal'), fab = document.getElementById('fab');
function abrirModal(tab) { modal.hidden = false; cambiarTab(tab || 'operacion'); document.querySelector('#formOperacion input[name=fecha]').value = hoyISO(); setTimeout(() => buscarInput.focus(), 60); }
function cerrarModal() {
  modal.hidden = true;
  document.getElementById('formOperacion').reset(); document.getElementById('formPrediccion').reset();
  acUl.hidden = true; document.getElementById('hintPrecio').textContent = '';
  segReset('segTipo', 'compra', 'inputTipo'); segReset('segDir', 'sube', 'inputDir');
}
function cambiarTab(name) { document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('activa', t.dataset.tab === name)); document.querySelectorAll('.panel-form').forEach((f) => (f.hidden = f.dataset.panel !== name)); }
function segReset(id, val, input) { document.querySelectorAll('#' + id + ' .seg').forEach((s) => s.classList.toggle('activa', (s.dataset.tipo || s.dataset.dir) === val)); document.getElementById(input).value = val; }
fab.addEventListener('click', () => abrirModal('operacion'));
document.getElementById('cerrarModal').addEventListener('click', cerrarModal);
modal.addEventListener('click', (e) => { if (e.target === modal) cerrarModal(); });
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => cambiarTab(t.dataset.tab)));
document.getElementById('segTipo').addEventListener('click', (e) => { const b = e.target.closest('.seg'); if (!b) return; segReset('segTipo', b.dataset.tipo, 'inputTipo'); });
document.getElementById('segDir').addEventListener('click', (e) => { const b = e.target.closest('.seg'); if (!b) return; segReset('segDir', b.dataset.dir, 'inputDir'); });

// ---------- Envío de formularios ----------
function avisoDemo() { toast('Estás en modo demo. Toca "Borrar y empezar de cero" para guardar lo tuyo.'); }
document.getElementById('formOperacion').addEventListener('submit', async (e) => {
  e.preventDefault(); if (modoDemo) { avisoDemo(); return; }
  const f = e.target;
  const cuerpo = { simbolo: f.simbolo.value, tipo: f.tipo.value, cantidad: f.cantidad.value, precio: f.precio.value, fecha: f.fecha.value, comision: f.comision.value, nota: f.nota.value, portafolio: PORT_ACTIVO };
  const r = await fetch('/api/operaciones', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
  if (r.ok) { cerrarModal(); toast('Operación guardada ✓'); cargar(); } else { const er = await r.json().catch(() => ({})); toast(er.error || 'No se pudo guardar'); }
});
document.getElementById('formPrediccion').addEventListener('submit', async (e) => {
  e.preventDefault(); if (modoDemo) { avisoDemo(); return; }
  const f = e.target;
  const cuerpo = { simbolo: f.simbolo.value, direccion: f.direccion.value, probabilidad: f.probabilidad.value, plazoDias: f.plazoDias.value, razon: f.razon.value, portafolio: PORT_ACTIVO };
  const r = await fetch('/api/predicciones', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
  if (r.ok) { cerrarModal(); toast('Lectura guardada ✓'); cargar(); } else { const er = await r.json().catch(() => ({})); toast(er.error || 'No se pudo guardar'); }
});

// ---------- Toasts ----------
function cerrarToast(t) { t.classList.add('saliendo'); setTimeout(() => t.remove(), 300); }
function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.innerHTML = '<span>' + esc(msg) + '</span>'; document.getElementById('toasts').appendChild(t); setTimeout(() => cerrarToast(t), 3400); }
function toastUndo(msg, onUndo, onCommit) {
  const t = document.createElement('div'); t.className = 'toast'; t.innerHTML = '<span>' + esc(msg) + '</span>';
  const btn = document.createElement('button'); btn.className = 'toast-undo'; btn.textContent = 'Deshacer'; t.appendChild(btn);
  document.getElementById('toasts').appendChild(t);
  let hecho = false;
  const timer = setTimeout(() => { if (hecho) return; hecho = true; cerrarToast(t); onCommit(); }, 5000);
  btn.onclick = () => { if (hecho) return; hecho = true; clearTimeout(timer); cerrarToast(t); onUndo(); };
}

// ---------- Borrado optimista (con deshacer) ----------
function borrarPosicion(sim) {
  ocultosSim.add(sim); render(ESTADO);
  toastUndo('Posición eliminada', () => { ocultosSim.delete(sim); render(ESTADO); }, async () => {
    const ids = (ESTADO.operaciones || []).filter((o) => o.simbolo === sim).map((o) => o.id);
    const qp = PORT_ACTIVO ? ('&portafolio=' + encodeURIComponent(PORT_ACTIVO)) : '';
    for (const tid of ids) { try { await fetch('/api/operaciones?id=' + tid + qp, { method: 'DELETE' }); } catch {} }
    ocultosSim.delete(sim); cargar();
  });
}
function borrarPred(id) {
  ocultosPred.add(id); render(ESTADO);
  toastUndo('Lectura eliminada', () => { ocultosPred.delete(id); render(ESTADO); }, async () => {
    try { await fetch('/api/predicciones?id=' + id + (PORT_ACTIVO ? ('&portafolio=' + encodeURIComponent(PORT_ACTIVO)) : ''), { method: 'DELETE' }); } catch {}
    ocultosPred.delete(id); cargar();
  });
}

// ---------- Click maestro (delegación) ----------
document.addEventListener('click', (e) => {
  const ab = e.target.closest('[data-abrir-modal]'); if (ab) { abrirModal(ab.dataset.abrirModal); return; }
  const del = e.target.closest('[data-borrar]'); if (del) { if (modoDemo) { avisoDemo(); return; } if (del.dataset.borrar === 'pos') borrarPosicion(del.dataset.sim); else borrarPred(del.dataset.id); return; }
  const filaPos = e.target.closest('#cuerpoPosiciones tr');
  if (filaPos && filaPos.dataset.sim) { abrirGrafico(filaPos.dataset.sim); return; }
  const inf = e.target.closest('[data-info]'); const pop = document.getElementById('popInfo');
  if (inf) { pop.textContent = inf.dataset.info; pop.hidden = false; const r = inf.getBoundingClientRect(); pop.style.top = (r.bottom + 8) + 'px'; pop.style.left = Math.min(r.left, innerWidth - 262) + 'px'; return; }
  pop.hidden = true;
  if (!e.target.closest('.campo-busqueda')) acUl.hidden = true;
  if (!e.target.closest('.buscador-global')) { const _bg = document.getElementById('resultadosGlobal'); if (_bg) _bg.hidden = true; }
});

// ---------- Atajos de teclado ----------
document.addEventListener('keydown', (e) => {
  const enInput = e.target.matches('input,select,textarea');
  if (e.key === 'Escape') { if (!modal.hidden) cerrarModal(); else if (!document.getElementById('tour').hidden) cerrarTour(); return; }
  if (enInput) return;
  if (e.key.toLowerCase() === 'n') abrirModal('operacion');
  else if (e.key === '/') { e.preventDefault(); abrirModal('operacion'); }
});

// ---------- Tour guiado ----------
const PASOS = [
  { sel: '[data-tour="heroe"]', t: 'Tu cartera de un vistazo', x: 'Aquí ves cuánto vale todo tu dinero hoy y cuánto has ganado o perdido en total.' },
  { sel: '[data-tour="proyeccion"]', t: 'Tu plata en 30 días', x: 'Mi proyección de cuánto podría valer tu cartera en un mes, con su rango probable (de menos a más). Se actualiza sola cada 2 días.' },
  { sel: '[data-tour="vigilantes"]', t: 'Tus vigilantes', x: 'Agentes que cuidan distintas áreas: movimientos fuertes, riesgo (concentración y caídas) y tus lecturas. Revisan solos y te avisan al correo si pasa algo.' },
  { sel: '[data-tour="reparto"]', t: '¿Dónde está tu dinero?', x: 'La dona muestra en qué activos está repartida tu plata. De un vistazo sabes si estás muy cargado en una sola cosa.' },
  { sel: '[data-tour="marcador"]', t: 'El marcador del bróker', x: 'Cada lectura (sube o baja) se anota con fecha. Al cumplir su plazo, el panel marca solo si acertó o falló. Este es mi porcentaje real de aciertos: sin trampa.' },
  { sel: '[data-tour="posiciones"]', t: 'Tus posiciones', x: 'Cada cosa que compraste, con su precio de ahora, su mini-gráfica de 5 días y tu ganancia en vivo.' },
  { sel: '[data-tour="lecturas"]', t: 'Las lecturas', x: 'Tus predicciones (o las que yo te dé en el chat) viven aquí con su resultado.' },
  { sel: '[data-tour="fab"]', t: 'Agregar es así de fácil', x: 'Toca el botón + para registrar una compra en segundos: escribe el nombre, el panel te trae el precio de ahora, y listo.' },
  { sel: '#btnComite', t: 'Mi Comité 🏛️', x: 'Tu comité de analistas: toca aquí para ver, acción por acción, qué tan sólida está cada una (puntaje 0–100) y qué opina cada experto, con su porqué.' },
];
let pasoIdx = 0;
function iniciarTour() { pasoIdx = 0; document.getElementById('tour').hidden = false; mostrarPaso(); }
function mostrarPaso() {
  const p = PASOS[pasoIdx], el = document.querySelector(p.sel);
  if (!el) { siguientePaso(); return; }
  el.scrollIntoView({ block: 'center', behavior: reducedMotion ? 'auto' : 'smooth' });
  setTimeout(() => {
    const r = el.getBoundingClientRect(), pad = 8;
    const hueco = document.getElementById('tourHueco');
    hueco.style.left = (r.left - pad) + 'px'; hueco.style.top = (r.top - pad) + 'px';
    hueco.style.width = (r.width + pad * 2) + 'px'; hueco.style.height = (r.height + pad * 2) + 'px';
    document.getElementById('tourTitulo').textContent = p.t;
    document.getElementById('tourTexto').textContent = p.x;
    document.getElementById('tourPaso').textContent = 'Paso ' + (pasoIdx + 1) + ' de ' + PASOS.length;
    document.getElementById('tourAtras').style.visibility = pasoIdx === 0 ? 'hidden' : 'visible';
    document.getElementById('tourSiguiente').textContent = pasoIdx === PASOS.length - 1 ? '¡Listo!' : 'Siguiente';
    const globo = document.getElementById('tourGlobo'), gh = globo.offsetHeight || 170, gw = Math.min(330, innerWidth * 0.86);
    let top = r.bottom + 14; if (top + gh > innerHeight - 10) top = Math.max(14, r.top - gh - 14);
    let left = Math.min(Math.max(14, r.left), innerWidth - gw - 14);
    globo.style.top = top + 'px'; globo.style.left = left + 'px';
  }, reducedMotion ? 0 : 320);
}
function siguientePaso() { if (pasoIdx < PASOS.length - 1) { pasoIdx++; mostrarPaso(); } else cerrarTour(); }
function atrasPaso() { if (pasoIdx > 0) { pasoIdx--; mostrarPaso(); } }
function cerrarTour() { document.getElementById('tour').hidden = true; localStorage.setItem('cartera_tour_visto', '1'); }
document.getElementById('tourSiguiente').addEventListener('click', siguientePaso);
document.getElementById('tourAtras').addEventListener('click', atrasPaso);
document.getElementById('tourSaltar').addEventListener('click', cerrarTour);
document.getElementById('btnAyuda').addEventListener('click', iniciarTour);
window.addEventListener('resize', () => { if (!document.getElementById('tour').hidden) mostrarPaso(); });

// ---------- Modo demo ----------
const ESTADO_DEMO = {
  moneda: 'USD', proveedor: 'datos de ejemplo', actualizado: '(demo)',
  resumen: { capitalInicial: 10000, invertido: 8400, valorActual: 10238, valorPosiciones: 10238, efectivo: 1600, valorTotal: 11838, gpTotal: 1838, gpTotalPct: 18.38, realizado: 120, cambioDia: 64, gananciaMes: { disponible: true, valor: 540 } },
  proyeccion: { generado: '2026-06-21T00:00:00Z', horizonteDias: 30, valorHoy: 11838, esperado: 12450, pesimista: 11100, optimista: 13800, pctEsperado: 5.17, anual: { valorHoy: 11838, esperado: 13050, pesimista: 9700, optimista: 16400, pctEsperado: 10.24 } },
  posiciones: [
    { simbolo: 'AAPL', cantidad: 15, costoPromedio: 150, precioActual: 182, moneda: 'USD', valor: 2730, gp: 480, gpPct: 21.3, cambioDia: 12, spark: [170, 172, 168, 176, 182], error: false },
    { simbolo: 'NVDA', cantidad: 10, costoPromedio: 110, precioActual: 138, moneda: 'USD', valor: 1380, gp: 280, gpPct: 25.5, cambioDia: 20, spark: [120, 128, 131, 135, 138], error: false },
    { simbolo: 'TSLA', cantidad: 8, costoPromedio: 240, precioActual: 268, moneda: 'USD', valor: 2144, gp: 224, gpPct: 11.7, cambioDia: -8, spark: [260, 272, 265, 270, 268], error: false },
    { simbolo: 'BTC-USD', cantidad: 0.05, costoPromedio: 52000, precioActual: 79680, moneda: 'USD', valor: 3984, gp: 1384, gpPct: 53.2, cambioDia: 40, spark: [60000, 72000, 75000, 77000, 79680], error: false },
  ],
  operaciones: [],
  predicciones: [
    { id: 'd1', simbolo: 'NVDA', direccion: 'sube', probabilidad: 70, plazoDias: 30, razon: 'IA en auge', fechaCreacion: '2026-05-20', precioInicial: 120, estado: 'acertada', precioFinal: 138, autor: 'claude' },
    { id: 'd2', simbolo: 'TSLA', direccion: 'sube', probabilidad: 60, plazoDias: 14, razon: 'entregas del trimestre', fechaCreacion: '2026-06-15', precioInicial: 268, estado: 'abierta', autor: 'claude' },
  ],
  marcador: { total: 1, aciertos: 1, tasa: 100, abiertas: 1 },
  vigilantes: { generado: '2026-06-21T14:30:00Z', agentes: [
    { id: 'movimientos', nombre: 'Vigía de Movimientos', emoji: '📡', estado: 'alerta', resumen: '1 movimiento fuerte hoy: BTC-USD ▲8.2%' },
    { id: 'riesgo', nombre: 'Vigía de Riesgo', emoji: '🛡️', estado: 'ok', resumen: 'Concentración OK (máx BTC-USD 34%). Día: +1.2%.' },
    { id: 'marcador', nombre: 'Vigía del Marcador', emoji: '🎯', estado: 'ok', resumen: '1 lectura abierta en vigilancia. Te aviso cuando cumpla su plazo.' },
    { id: 'politicos', nombre: 'Vigía de Políticos', emoji: '🏛️', estado: 'inactivo', resumen: 'En pausa: necesita una fuente de datos para activarse.' },
  ] },
  historico: [
    { fecha: '2026-06-14', valorTotal: 9100 }, { fecha: '2026-06-15', valorTotal: 9320 }, { fecha: '2026-06-16', valorTotal: 9210 },
    { fecha: '2026-06-17', valorTotal: 9580 }, { fecha: '2026-06-18', valorTotal: 9760 }, { fecha: '2026-06-19', valorTotal: 10010 },
    { fecha: '2026-06-20', valorTotal: 9930 }, { fecha: '2026-06-21', valorTotal: 10238 },
  ],
};
function entrarDemo() { modoDemo = true; ESTADO = ESTADO_DEMO; document.getElementById('bannerDemo').hidden = false; pintarTodo(ESTADO_DEMO); }
document.getElementById('btnSalirDemo').addEventListener('click', () => { localStorage.setItem('cartera_tour_visto', '1'); cargar(); });
const _verDemo = document.getElementById('btnVerDemo'); if (_verDemo) _verDemo.addEventListener('click', entrarDemo);

// ---------- Gráfico grande (estilo MarketWatch) ----------
const mg = {
  modal: document.getElementById('modalGrafico'),
  svg: document.getElementById('mgGrafico'),
  wrap: document.getElementById('mgWrap'),
  tooltip: document.getElementById('mgTooltip'),
  cargando: document.getElementById('mgCargando'),
  simbolo: null, rango: '1d', puntos: [], W: 600, H: 280, pad: 10, timer: null,
  x: (i) => i, y: (v) => v,
};
async function abrirGrafico(simbolo) {
  mg.simbolo = simbolo; mg.rango = '1d';
  document.getElementById('mgSimbolo').textContent = simbolo;
  document.getElementById('mgPrecio').textContent = '';
  document.getElementById('mgCambio').textContent = '';
  document.querySelectorAll('#mgRangos .rango').forEach((b) => b.classList.toggle('activa', b.dataset.r === '1d'));
  mg.modal.hidden = false;
  await cargarGrafico();
  clearInterval(mg.timer);
  mg.timer = setInterval(() => { if (!mg.modal.hidden && !document.hidden) cargarGrafico(true); }, 60000);
}
function cerrarGrafico() { mg.modal.hidden = true; clearInterval(mg.timer); mg.tooltip.hidden = true; }
async function cargarGrafico(silencioso) {
  if (!silencioso) mg.cargando.hidden = false;
  try {
    const r = await fetch(`/api/historial?simbolo=${encodeURIComponent(mg.simbolo)}&rango=${mg.rango}`);
    const d = await r.json();
    mg.cargando.hidden = true;
    mg.puntos = d.puntos || [];
    if (d.moneda) MONEDA = d.moneda;
    const precio = d.precio != null ? d.precio : (mg.puntos.length ? mg.puntos[mg.puntos.length - 1].c : null);
    const base = mg.puntos.length ? mg.puntos[0].c : (d.cierreAnterior != null ? d.cierreAnterior : null);
    document.getElementById('mgPrecio').textContent = precio != null ? fmtDinero(precio) : '—';
    const camb = document.getElementById('mgCambio');
    if (precio != null && base != null && base !== 0) {
      const dif = precio - base, pct = (dif / base) * 100;
      camb.textContent = (dif >= 0 ? '▲ ' : '▼ ') + fmtPct(pct);
      camb.className = 'num ' + clase(dif);
    } else camb.textContent = '';
    dibujarGrafico();
  } catch {
    mg.cargando.hidden = true;
    mg.svg.innerHTML = `<text x="300" y="140" text-anchor="middle" fill="${COL.faint}" font-size="14">No se pudo cargar</text>`;
  }
}
function dibujarGrafico() {
  const p = mg.puntos, W = mg.W, H = mg.H, pad = mg.pad;
  if (!p || p.length < 2) { mg.svg.innerHTML = `<text x="300" y="140" text-anchor="middle" fill="${COL.faint}" font-size="14">Sin datos para este rango</text>`; return; }
  const vals = p.map((x) => x.c), min = Math.min(...vals), max = Math.max(...vals), rg = (max - min) || 1;
  mg.x = (i) => pad + (i / (p.length - 1)) * (W - 2 * pad);
  mg.y = (v) => H - pad - ((v - min) / rg) * (H - 2 * pad);
  let d = '';
  p.forEach((pt, i) => { d += (i ? 'L' : 'M') + mg.x(i).toFixed(1) + ',' + mg.y(pt.c).toFixed(1) + ' '; });
  const area = d + 'L' + mg.x(p.length - 1).toFixed(1) + ',' + H + ' L' + mg.x(0).toFixed(1) + ',' + H + ' Z';
  const c = vals[vals.length - 1] >= vals[0] ? COL.green : COL.red;
  // Eje Y: lineas guia + etiquetas de precio
  const niveles = 4; let grid = '', ejeHTML = '';
  for (let i = 0; i <= niveles; i++) {
    const v = min + (max - min) * (i / niveles), yy = mg.y(v);
    grid += `<line x1="0" y1="${yy.toFixed(1)}" x2="${W}" y2="${yy.toFixed(1)}" stroke="rgba(255,255,255,0.06)" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
    const abs = Math.abs(v), dec = abs < 10 ? 2 : (abs < 100 ? 1 : 0);
    ejeHTML += `<span style="top:${((yy / H) * 100).toFixed(2)}%">$${v.toFixed(dec)}</span>`;
  }
  mg.svg.innerHTML = `<defs><linearGradient id="mgGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c}" stop-opacity="0.35"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></linearGradient></defs>
    ${grid}
    <path d="${area}" fill="url(#mgGrad)"/>
    <path id="mgLinea" d="${d}" fill="none" stroke="${c}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    <line id="mgCross" y1="0" y2="${H}" stroke="${COL.muted}" stroke-width="1" stroke-dasharray="4 4" opacity="0" vector-effect="non-scaling-stroke"/>
    <circle id="mgDot" r="4" fill="${c}" stroke="#0a1122" stroke-width="2" opacity="0"/>`;
  const eje = document.getElementById('mgEjeY'); if (eje) eje.innerHTML = ejeHTML;
  if (!reducedMotion) { const l = mg.svg.querySelector('#mgLinea'); const len = l.getTotalLength(); l.style.strokeDasharray = len; l.style.strokeDashoffset = len; requestAnimationFrame(() => { l.style.transition = 'stroke-dashoffset 1s cubic-bezier(0.16,1,0.3,1)'; l.style.strokeDashoffset = 0; }); }
}
function hoverGrafico(e) {
  const p = mg.puntos; if (!p || p.length < 2) return;
  const rect = mg.wrap.getBoundingClientRect();
  let fx = (e.clientX - rect.left) / rect.width; fx = Math.max(0, Math.min(1, fx));
  const i = Math.round(fx * (p.length - 1)), pt = p[i]; if (!pt) return;
  const cross = mg.svg.querySelector('#mgCross'), dot = mg.svg.querySelector('#mgDot');
  if (cross) { cross.setAttribute('x1', mg.x(i)); cross.setAttribute('x2', mg.x(i)); cross.setAttribute('opacity', '1'); }
  if (dot) { dot.setAttribute('cx', mg.x(i)); dot.setAttribute('cy', mg.y(pt.c)); dot.setAttribute('opacity', '1'); }
  const fecha = new Date(pt.t);
  const fstr = (mg.rango === '1d' || mg.rango === '5d')
    ? fecha.toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    : fecha.toLocaleDateString('es', { day: '2-digit', month: 'short', year: '2-digit' });
  mg.tooltip.innerHTML = '<b>' + fmtDinero(pt.c) + '</b><div class="mg-fecha">' + fstr + '</div>';
  mg.tooltip.hidden = false;
  mg.tooltip.style.left = ((i / (p.length - 1)) * rect.width) + 'px';
  mg.tooltip.style.top = ((mg.y(pt.c) / mg.H) * rect.height) + 'px';
}
function salirHover() { mg.tooltip.hidden = true; const c = mg.svg.querySelector('#mgCross'), d = mg.svg.querySelector('#mgDot'); if (c) c.setAttribute('opacity', '0'); if (d) d.setAttribute('opacity', '0'); }
document.getElementById('cerrarGrafico').addEventListener('click', cerrarGrafico);
mg.modal.addEventListener('click', (e) => { if (e.target === mg.modal) cerrarGrafico(); });
document.getElementById('mgRangos').addEventListener('click', (e) => { const b = e.target.closest('.rango'); if (!b) return; mg.rango = b.dataset.r; document.querySelectorAll('#mgRangos .rango').forEach((x) => x.classList.toggle('activa', x === b)); cargarGrafico(); });
mg.wrap.addEventListener('mousemove', hoverGrafico);
mg.wrap.addEventListener('mouseleave', salirHover);
mg.wrap.addEventListener('touchmove', (e) => { if (e.touches[0]) hoverGrafico(e.touches[0]); }, { passive: true });

// ---------- Buscador global (toda la bolsa) ----------
const bgInput = document.getElementById('buscadorGlobal'), bgUl = document.getElementById('resultadosGlobal');
let bgTimer, bgItems = [], bgIdx = -1;
bgInput.addEventListener('input', () => { clearTimeout(bgTimer); const q = bgInput.value.trim(); if (q.length < 1) { bgUl.hidden = true; return; } bgTimer = setTimeout(() => bgBuscar(q), 250); });
async function bgBuscar(q) { try { const r = await fetch('/api/buscar?q=' + encodeURIComponent(q)); const j = await r.json(); bgItems = j.resultados || []; bgPintar(); } catch { bgUl.hidden = true; } }
function bgPintar() { if (!bgItems.length) { bgUl.hidden = true; return; } bgIdx = -1; bgUl.innerHTML = bgItems.map((x, i) => `<li data-i="${i}"><span><span class="ac-sim">${esc(x.simbolo)}</span> <span class="ac-nom">${esc(x.nombre)}</span></span><span class="ac-bolsa">${esc(x.bolsa)}</span></li>`).join(''); bgUl.hidden = false; }
function bgElegir(i) { const x = bgItems[i]; if (!x) return; bgUl.hidden = true; bgInput.value = ''; abrirGrafico(x.simbolo); }
bgUl.addEventListener('click', (e) => { const li = e.target.closest('li'); if (li) bgElegir(+li.dataset.i); });
bgInput.addEventListener('keydown', (e) => { if (bgUl.hidden) return; if (e.key === 'ArrowDown') { e.preventDefault(); bgIdx = Math.min(bgIdx + 1, bgItems.length - 1); bgMarcar(); } else if (e.key === 'ArrowUp') { e.preventDefault(); bgIdx = Math.max(bgIdx - 1, 0); bgMarcar(); } else if (e.key === 'Enter' && bgIdx >= 0) { e.preventDefault(); bgElegir(bgIdx); } else if (e.key === 'Escape') bgUl.hidden = true; });
function bgMarcar() { [...bgUl.children].forEach((li, i) => li.classList.toggle('activa', i === bgIdx)); }

// ---------- Mi Comité (análisis por acción) ----------
let COMITE = null;
const AREAS = [
  { k: 'valuacion', e: '🔍', n: 'Valuación' }, { k: 'riesgo', e: '🛡️', n: 'Riesgo' },
  { k: 'moat', e: '🏰', n: 'Moat' }, { k: 'tecnico', e: '📈', n: 'Técnico' },
  { k: 'macro', e: '🌎', n: 'Macro' }, { k: 'catalizadores', e: '📰', n: 'Catalizadores' },
  { k: 'politicos', e: '🏛️', n: 'Políticos' }, { k: 'dividendos', e: '💵', n: 'Dividendos' },
];
const MOONSHOTS = new Set(['VRDN', 'RDW', 'CRML', 'SERV', 'RCAT', 'NNE']);
function colorPuntaje(p) { return p == null ? COL.faint : (p >= 60 ? COL.green : (p >= 40 ? COL.accent : COL.red)); }
function claseComite(p) { return p == null ? 'c-nd' : (p >= 60 ? 'c-ok' : (p >= 40 ? 'c-med' : 'c-mal')); }
function veredictoCorto(a) {
  if (a.director && a.director.veredicto) return a.director.veredicto;
  const p = a.compuesto; if (p == null) return 'Sin datos';
  return p >= 70 ? 'Sólida' : (p >= 60 ? 'Mantener' : (p >= 45 ? 'Vigilar' : (p >= 35 ? 'Especulativa' : 'Riesgo alto')));
}
function listaAcciones() { return (COMITE && COMITE.acciones) ? Object.values(COMITE.acciones) : []; }
async function cargarComite() {
  try { const r = await fetch('/api/comite'); COMITE = await r.json(); } catch { COMITE = { acciones: {} }; }
  pintarTablero();
}
function verTablero() { document.getElementById('comiteInforme').hidden = true; document.getElementById('comiteComparar').hidden = true; document.getElementById('comiteTablero').hidden = false; }
function mostrarComite() {
  document.getElementById('vistaPanel').hidden = true;
  document.getElementById('vistaComite').hidden = false;
  verTablero(); window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' });
  if (!COMITE) cargarComite();
}
function mostrarPanel() { document.getElementById('vistaComite').hidden = true; document.getElementById('vistaPanel').hidden = false; }

function pintarTablero() {
  const grid = document.getElementById('comiteGrid'); if (!grid) return;
  const q = (document.getElementById('comiteBuscar').value || '').trim().toUpperCase();
  const orden = document.getElementById('comiteOrden').value;
  let arr = listaAcciones().filter((a) => !q || a.simbolo.includes(q) || (a.nombre || '').toUpperCase().includes(q));
  arr.sort((a, b) => orden === 'alfa' ? a.simbolo.localeCompare(b.simbolo) : (orden === 'peor' ? (a.compuesto == null ? 999 : a.compuesto) - (b.compuesto == null ? 999 : b.compuesto) : (b.compuesto == null ? -1 : b.compuesto) - (a.compuesto == null ? -1 : a.compuesto)));
  if (!arr.length) { grid.innerHTML = '<p class="grafico-vacio">Aún no hay análisis. Toca "Re-analizar" o pídeme en el chat que arme el comité.</p>'; return; }
  grid.innerHTML = arr.map((a) => {
    const p = a.compuesto, col = colorPuntaje(p);
    return `<button class="comite-card ${claseComite(p)}" data-sim="${esc(a.simbolo)}">
      <div class="cc-top"><span class="cc-sim">${esc(a.simbolo)}</span><span class="cc-punt" style="color:${col}">${p == null ? '—' : p}</span></div>
      <div class="cc-nombre">${esc((a.nombre || '').slice(0, 24))}</div>
      <div class="cc-barra"><div style="width:${p == null ? 0 : p}%;background:${col}"></div></div>
      <span class="cc-vered ${claseComite(p)}">${esc(veredictoCorto(a))}</span>
    </button>`;
  }).join('');
  const g = document.getElementById('comiteGenerado');
  if (g) g.textContent = (COMITE && COMITE.generado) ? ('Números actualizados: ' + new Date(COMITE.generado).toLocaleDateString('es', { day: '2-digit', month: 'short' })) : '';
}

function radarSVG(acc) {
  const cx = 110, cy = 110, R = 80, N = AREAS.length;
  const vals = AREAS.map((ar) => { const a = acc.analistas[ar.k]; return (a && typeof a.puntaje === 'number') ? a.puntaje : 0; });
  const ang = (i) => -Math.PI / 2 + i * 2 * Math.PI / N;
  const pt = (i, r) => [cx + r * Math.cos(ang(i)), cy + r * Math.sin(ang(i))];
  let grid = '';
  for (const f of [0.25, 0.5, 0.75, 1]) { const poly = AREAS.map((_, i) => pt(i, R * f).map((n) => n.toFixed(1)).join(',')).join(' '); grid += `<polygon points="${poly}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>`; }
  let axes = '', labels = '';
  AREAS.forEach((ar, i) => { const [x, y] = pt(i, R); axes += `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="rgba(255,255,255,0.08)"/>`; const [lx, ly] = pt(i, R + 16); labels += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" font-size="12" text-anchor="middle" dominant-baseline="middle">${ar.e}</text>`; });
  const valPoly = AREAS.map((_, i) => pt(i, R * (vals[i] / 100)).map((n) => n.toFixed(1)).join(',')).join(' ');
  return `<svg viewBox="0 0 220 220" class="radar" aria-label="Radar de las 8 áreas">${grid}${axes}<polygon points="${valPoly}" fill="${COL.accent}" fill-opacity="0.25" stroke="${COL.accent}" stroke-width="2"/>${labels}</svg>`;
}

function abrirInforme(sim) {
  const a = COMITE && COMITE.acciones && COMITE.acciones[sim]; if (!a) return;
  const cont = document.getElementById('comiteInforme'), dir = a.director || {}, p = a.compuesto, col = colorPuntaje(p);
  const barras = AREAS.map((ar) => {
    const an = a.analistas[ar.k] || {};
    const punt = (an.estado === 'inactivo' || typeof an.puntaje !== 'number') ? null : an.puntaje;
    const c = colorPuntaje(punt);
    return `<div class="inf-fila" data-area="${ar.k}">
      <div class="inf-fila-top">
        <span class="inf-area">${ar.e} ${ar.n}</span>
        <div class="inf-barra"><div style="width:${punt == null ? 0 : punt}%;background:${c}"></div></div>
        <span class="inf-punt">${punt == null ? '<small>s/d</small>' : punt}</span>
      </div>
      <div class="inf-detalle">
        <div class="inf-vered">${esc(an.veredicto || 'Sin datos')}</div>
        ${(an.razones || []).map((r) => `<div class="inf-razon">· ${esc(r)}</div>`).join('')}
        ${an.fuente === 'claude' ? '<span class="inf-fuente">opinión de Claude</span>' : (an.fuente === 'datos' ? '<span class="inf-fuente">cálculo de datos</span>' : '')}
      </div>
    </div>`;
  }).join('');
  const aviso = (MOONSHOTS.has(sim) || (p != null && p < 40)) ? '<p class="inf-aviso">⚠️ Acción especulativa: riesgo real de caer mucho o hasta a cero. Mantenla en tamaño chico.</p>' : '';
  cont.innerHTML = `
    <button class="btn-fantasma inf-volver">← Volver al tablero</button>
    <div class="inf-banner ${claseComite(p)}">
      <div class="inf-banner-izq">
        <div class="inf-sim">${esc(a.simbolo)} <span class="inf-tipo">${a.tipoActivo === 'etf' ? 'fondo (ETF)' : 'acción'}</span></div>
        <div class="inf-tesis">${esc(dir.tesis || 'Pídeme en el chat que genere las opiniones (moat, macro, catalizadores) para completar el veredicto del Director.')}</div>
        ${dir.riesgoPrincipal ? `<div class="inf-riesgo"><strong>Riesgo principal:</strong> ${esc(dir.riesgoPrincipal)}</div>` : ''}
      </div>
      <div class="inf-banner-der"><div class="inf-comp" style="color:${col}">${p == null ? '—' : p}</div><div class="inf-vlabel">${esc(veredictoCorto(a))}</div>${dir.confianza ? `<div class="inf-conf">confianza ${dir.confianza}%</div>` : ''}</div>
    </div>
    <div class="inf-cuerpo">
      <div class="inf-radar">${radarSVG(a)}<button class="btn-fantasma inf-grafico" data-sim="${esc(a.simbolo)}">📈 Ver gráfico de precio</button></div>
      <div class="inf-barras">${barras}</div>
    </div>
    ${aviso}
    <p class="comite-sello">Análisis probabilístico, no asesoría financiera licenciada.</p>`;
  document.getElementById('comiteTablero').hidden = true; document.getElementById('comiteComparar').hidden = true; cont.hidden = false;
  cont.scrollIntoView({ block: 'start', behavior: reducedMotion ? 'auto' : 'smooth' });
}

function pintarComparar() {
  const cont = document.getElementById('comiteComparar'), arr = listaAcciones(); if (!arr.length) return;
  const opts = arr.map((a) => `<option value="${esc(a.simbolo)}">${esc(a.simbolo)}</option>`).join('');
  cont.innerHTML = `
    <button class="btn-fantasma cmp-volver">← Volver al tablero</button>
    <div class="cmp-selects"><select id="cmpA">${opts}</select><span class="cmp-vs">vs</span><select id="cmpB">${opts}</select></div>
    <div class="cmp-cols" id="cmpCols"></div>`;
  document.getElementById('cmpA').value = arr[0].simbolo; document.getElementById('cmpB').value = (arr[1] || arr[0]).simbolo;
  const pintar = () => {
    const A = COMITE.acciones[document.getElementById('cmpA').value], B = COMITE.acciones[document.getElementById('cmpB').value];
    document.getElementById('cmpCols').innerHTML = [A, B].map((a) => `<div class="cmp-col"><div class="cmp-head"><span>${esc(a.simbolo)}</span><span style="color:${colorPuntaje(a.compuesto)}">${a.compuesto == null ? '—' : a.compuesto}</span></div>${radarSVG(a)}${AREAS.map((ar) => { const an = a.analistas[ar.k] || {}; const punt = typeof an.puntaje === 'number' ? an.puntaje : null; return `<div class="cmp-fila"><span>${ar.e} ${ar.n}</span><b style="color:${colorPuntaje(punt)}">${punt == null ? 's/d' : punt}</b></div>`; }).join('')}</div>`).join('');
  };
  document.getElementById('cmpA').onchange = pintar; document.getElementById('cmpB').onchange = pintar; pintar();
  document.getElementById('comiteTablero').hidden = true; document.getElementById('comiteInforme').hidden = true; cont.hidden = false;
}

document.getElementById('btnComite').addEventListener('click', mostrarComite);
document.getElementById('comiteVolver').addEventListener('click', mostrarPanel);
document.getElementById('comiteBuscar').addEventListener('input', pintarTablero);
document.getElementById('comiteOrden').addEventListener('change', pintarTablero);
document.getElementById('comiteAbrirComparar').addEventListener('click', () => { if (!COMITE) cargarComite().then(pintarComparar); else pintarComparar(); });
document.getElementById('comiteReanalizar').addEventListener('click', async () => {
  toast('Re-analizando los números…');
  try { const r = await fetch('/api/comite/reanalizar', { method: 'POST' }); const j = await r.json(); toast(j.mensaje || 'En marcha'); setTimeout(cargarComite, 30000); } catch { toast('No se pudo re-analizar'); }
});
document.getElementById('comiteGrid').addEventListener('click', (e) => { const b = e.target.closest('.comite-card'); if (b) abrirInforme(b.dataset.sim); });
document.getElementById('comiteInforme').addEventListener('click', (e) => {
  if (e.target.closest('.inf-volver')) { verTablero(); return; }
  const g = e.target.closest('.inf-grafico'); if (g) { abrirGrafico(g.dataset.sim); return; }
  const fila = e.target.closest('.inf-fila'); if (fila) fila.classList.toggle('abierta');
});
document.getElementById('comiteComparar').addEventListener('click', (e) => { if (e.target.closest('.cmp-volver')) verTablero(); });

// ---------- Arranque ----------
async function init() {
  let real = null;
  try { const r = await fetch('/api/estado'); real = await r.json(); } catch {}
  if (real) { ESTADO = real; pintarTodo(real); }
  else document.getElementById('infoFuente').textContent = 'No se pudo conectar con el motor.';
  if (!localStorage.getItem('cartera_tour_visto')) iniciarTour();
  setInterval(() => { if (!modoDemo && !document.hidden) cargar(); }, 60000);
}
init();
