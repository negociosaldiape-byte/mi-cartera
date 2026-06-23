// ============================================================
//  server.js  —  Motor del Panel de Inversiones
//  Node.js puro, SIN dependencias. No se instala nada.
// ============================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');

const RAIZ = __dirname;
const ARCHIVO_DATOS = path.join(RAIZ, 'data.json');
const ARCHIVO_CONFIG = path.join(RAIZ, 'config.json');
const CARPETA_PUBLICA = path.join(RAIZ, 'public');

// ---------------- Configuracion ----------------
function leerConfig() {
  try {
    return JSON.parse(fs.readFileSync(ARCHIVO_CONFIG, 'utf8'));
  } catch {
    return { proveedorPrecios: 'yahoo', apiKeyFinnhub: '', monedaBase: 'USD', puerto: 3000 };
  }
}

// ---------------- Almacenamiento (archivo local o base de datos en la nube) ----------------
// Si hay variables de Upstash (Redis en la nube), guarda ahi para que tus datos NO
// se borren al reiniciar en la nube. Si no, usa el archivo local data.json (modo local).
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL || '';
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const USA_NUBE = !!(UPSTASH_URL && UPSTASH_TOKEN);
const CLAVE_DATOS = 'cartera';
const CAPITAL_DEFECTO = 10000;

function portafolioVacio(id, nombre, riesgo) {
  return { id, nombre, riesgo, capitalInicial: CAPITAL_DEFECTO, operaciones: [], predicciones: [], snapshots: [] };
}
function datosVacios() {
  return { version: 2, activo: 'agresivo', portafolios: [portafolioVacio('agresivo', 'Agresivo', 8.5)] };
}
function normalizaPortafolio(p, idx) {
  p = p || {};
  p.id = p.id || ('p' + (idx || 0));
  p.nombre = p.nombre || p.id;
  if (typeof p.riesgo !== 'number') p.riesgo = null;
  if (typeof p.capitalInicial !== 'number') p.capitalInicial = CAPITAL_DEFECTO;
  p.operaciones = p.operaciones || [];
  p.predicciones = p.predicciones || [];
  p.snapshots = p.snapshots || [];
  return p;
}
function normaliza(d) {
  d = d || {};
  // Migracion del formato viejo {operaciones,...} -> multi-portafolio
  if (!Array.isArray(d.portafolios)) {
    if (d.operaciones || d.predicciones || d.snapshots) {
      const viejo = { id: 'agresivo', nombre: 'Agresivo', riesgo: 8.5, capitalInicial: CAPITAL_DEFECTO, operaciones: d.operaciones || [], predicciones: d.predicciones || [], snapshots: d.snapshots || [] };
      d = { version: 2, activo: 'agresivo', portafolios: [viejo] };
    } else {
      d = datosVacios();
    }
  }
  d.version = 2;
  d.portafolios = d.portafolios.map(normalizaPortafolio);
  if (!d.portafolios.length) d.portafolios.push(portafolioVacio('agresivo', 'Agresivo', 8.5));
  if (!d.activo || !d.portafolios.find((p) => p.id === d.activo)) d.activo = d.portafolios[0].id;
  return d;
}
function getPortafolio(d, id) {
  return d.portafolios.find((p) => p.id === id) || d.portafolios.find((p) => p.id === d.activo) || d.portafolios[0];
}

let DATOS = datosVacios(); // copia en memoria (solo se usa en modo nube)

async function upstashComando(cmd) {
  const r = await fetch(UPSTASH_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + UPSTASH_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  if (!r.ok) throw new Error('Upstash HTTP ' + r.status);
  return r.json();
}

function leerArchivo() {
  try { return normaliza(JSON.parse(fs.readFileSync(ARCHIVO_DATOS, 'utf8'))); }
  catch { return datosVacios(); }
}

async function leerDatos() {
  if (!USA_NUBE) return leerArchivo();
  // Leer SIEMPRE fresco de Upstash: evita pisar cambios externos (siembra, otra pestaña, otro dispositivo).
  try {
    const j = await upstashComando(['GET', CLAVE_DATOS]);
    DATOS = j && j.result ? normaliza(JSON.parse(j.result)) : datosVacios();
  } catch (e) {
    console.error('[datos] No se pudo leer Upstash, uso copia en memoria:', e.message);
  }
  return normaliza(DATOS);
}
function guardarDatos(d) {
  d = normaliza(d);
  if (USA_NUBE) {
    DATOS = d;
    upstashComando(['SET', CLAVE_DATOS, JSON.stringify(d)]).catch((e) => console.error('[datos] Error guardando en Upstash:', e.message));
  } else {
    try { fs.writeFileSync(ARCHIVO_DATOS, JSON.stringify(d, null, 2), 'utf8'); }
    catch (e) { console.error('[datos] Error guardando archivo:', e.message); }
  }
}
async function cargarInicial() {
  if (!USA_NUBE) return; // en local se lee el archivo en cada peticion
  try {
    const j = await upstashComando(['GET', CLAVE_DATOS]);
    DATOS = j && j.result ? normaliza(JSON.parse(j.result)) : datosVacios();
    console.log('[datos] Conectado a la nube (Upstash).');
  } catch (e) {
    console.error('[datos] No se pudo leer de Upstash:', e.message);
    DATOS = datosVacios();
  }
}

async function leerProyeccion() {
  if (USA_NUBE) {
    try { const j = await upstashComando(['GET', 'proyeccion']); return j && j.result ? JSON.parse(j.result) : null; }
    catch { return null; }
  }
  try { return JSON.parse(fs.readFileSync(path.join(RAIZ, 'proyeccion.json'), 'utf8')); }
  catch { return null; }
}

async function leerVigilantes() {
  if (USA_NUBE) {
    try { const j = await upstashComando(['GET', 'vigilantes']); return j && j.result ? JSON.parse(j.result) : null; }
    catch { return null; }
  }
  try { return JSON.parse(fs.readFileSync(path.join(RAIZ, 'vigilantes.json'), 'utf8')); }
  catch { return null; }
}

function nuevoId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function hoyISO() {
  const d = new Date();
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

// ---------------- Precios en vivo ----------------
const cachePrecios = new Map(); // simbolo -> { precio, moneda, cierreAnterior, hora, error }
const CACHE_MS = 60 * 1000;     // no pedir el mismo precio mas de 1 vez por minuto

async function precioYahoo(simbolo) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(simbolo)}?interval=1d&range=5d`;
  const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!resp.ok) throw new Error('Yahoo HTTP ' + resp.status);
  const j = await resp.json();
  const result = j && j.chart && j.chart.result && j.chart.result[0];
  const meta = result && result.meta;
  if (!meta || typeof meta.regularMarketPrice !== 'number') throw new Error('Sin precio');
  let spark = [];
  try {
    spark = (result.indicators.quote[0].close || []).filter((x) => typeof x === 'number');
  } catch { spark = []; }
  return {
    precio: meta.regularMarketPrice,
    moneda: meta.currency || 'USD',
    cierreAnterior: (typeof meta.chartPreviousClose === 'number') ? meta.chartPreviousClose
      : (typeof meta.previousClose === 'number' ? meta.previousClose : null),
    spark,
  };
}

async function precioFinnhub(simbolo, apiKey) {
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(simbolo)}&token=${apiKey}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('Finnhub HTTP ' + resp.status);
  const j = await resp.json();
  if (typeof j.c !== 'number' || j.c === 0) throw new Error('Sin precio');
  return { precio: j.c, moneda: 'USD', cierreAnterior: (typeof j.pc === 'number' ? j.pc : null), spark: [] };
}

async function obtenerPrecio(simbolo) {
  const enCache = cachePrecios.get(simbolo);
  if (enCache && (Date.now() - enCache.hora) < CACHE_MS) return enCache;

  const cfg = leerConfig();
  try {
    let info;
    if (cfg.proveedorPrecios === 'finnhub' && cfg.apiKeyFinnhub) {
      info = await precioFinnhub(simbolo, cfg.apiKeyFinnhub);
    } else {
      info = await precioYahoo(simbolo);
    }
    info.hora = Date.now();
    info.error = false;
    cachePrecios.set(simbolo, info);
    return info;
  } catch (e) {
    // Si falla, devolvemos precio nulo (el panel muestra "—") sin romperse.
    const fallo = { precio: null, moneda: cfg.monedaBase || 'USD', cierreAnterior: null, hora: Date.now(), error: true, spark: [] };
    cachePrecios.set(simbolo, fallo);
    return fallo;
  }
}

// ---------------- Calculo de la cartera ----------------
// Metodo de costo promedio.
function calcularPosiciones(operaciones) {
  const mapa = new Map();
  const ops = [...operaciones].sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''));
  let realizado = 0;
  for (const op of ops) {
    const s = String(op.simbolo || '').toUpperCase();
    if (!s) continue;
    if (!mapa.has(s)) mapa.set(s, { simbolo: s, cantidad: 0, costoTotal: 0 });
    const pos = mapa.get(s);
    const cant = Number(op.cantidad) || 0;
    const precio = Number(op.precio) || 0;
    const comision = Number(op.comision) || 0;
    if (op.tipo === 'venta') {
      const costoProm = pos.cantidad > 0 ? pos.costoTotal / pos.cantidad : 0;
      realizado += (precio - costoProm) * cant - comision;
      pos.cantidad -= cant;
      pos.costoTotal -= costoProm * cant;
      if (pos.cantidad <= 0.0000001) { pos.cantidad = 0; pos.costoTotal = 0; }
    } else {
      pos.cantidad += cant;
      pos.costoTotal += precio * cant + comision;
    }
  }
  const posiciones = [...mapa.values()].filter((p) => p.cantidad > 0.0000001);
  return { posiciones, realizado };
}

function registrarSnapshot(p, valorTotal) {
  if (valorTotal == null || isNaN(valorTotal)) return;
  const hoy = hoyISO();
  const existe = p.snapshots.find((s) => s.fecha === hoy);
  if (existe) existe.valorTotal = valorTotal;
  else p.snapshots.push({ fecha: hoy, valorTotal });
  p.snapshots.sort((a, b) => a.fecha.localeCompare(b.fecha));
}

// Efectivo libre = capital inicial - lo gastado en compras + lo recibido en ventas
function calcularEfectivo(p) {
  let cash = (typeof p.capitalInicial === 'number') ? p.capitalInicial : CAPITAL_DEFECTO;
  for (const op of p.operaciones || []) {
    const monto = (Number(op.cantidad) || 0) * (Number(op.precio) || 0);
    const com = Number(op.comision) || 0;
    if (op.tipo === 'venta') cash += monto - com;
    else cash -= monto + com;
  }
  return cash;
}

function calcularGananciaMes(p, valorTotal) {
  const hoy = hoyISO();
  const inicioMes = hoy.slice(0, 8) + '01';
  const anteriores = (p.snapshots || []).filter((s) => s.fecha < hoy);
  if (!anteriores.length) return { disponible: false };

  const previosAlMes = anteriores.filter((s) => s.fecha < inicioMes);
  let base;
  if (previosAlMes.length) {
    base = previosAlMes[previosAlMes.length - 1].valorTotal;
  } else {
    const delMes = (p.snapshots || []).filter((s) => s.fecha >= inicioMes && s.fecha < hoy);
    if (!delMes.length) return { disponible: false };
    base = delMes[0].valorTotal;
  }
  // Capital fijo: el valor total ya incluye el efectivo, no hay aportes externos que descontar.
  return { disponible: true, valor: valorTotal - base };
}

// ---------------- Evaluacion de predicciones ----------------
async function evaluarPredicciones(pf) {
  const ahora = new Date();
  for (const pr of pf.predicciones) {
    if (pr.estado !== 'abierta') continue;
    if (pr.precioInicial == null) continue;
    const creada = new Date(pr.fechaCreacion + 'T00:00:00');
    const vence = new Date(creada.getTime() + (Number(pr.plazoDias) || 0) * 86400000);
    if (ahora >= vence) {
      const info = await obtenerPrecio(pr.simbolo);
      if (info.precio == null) continue; // se intentara de nuevo luego
      pr.precioFinal = info.precio;
      pr.fechaEvaluacion = hoyISO();
      const subio = info.precio > pr.precioInicial;
      const bajo = info.precio < pr.precioInicial;
      if (pr.direccion === 'sube') pr.estado = subio ? 'acertada' : 'fallada';
      else pr.estado = bajo ? 'acertada' : 'fallada';
    }
  }
}

// ---------------- Estado completo para el panel ----------------
// Valor de las posiciones de un portafolio (suma de precio*cantidad con precios en vivo)
async function valorPosiciones(operaciones) {
  const { posiciones } = calcularPosiciones(operaciones);
  let total = 0, hay = false;
  for (const pos of posiciones) {
    const info = await obtenerPrecio(pos.simbolo);
    if (info.precio != null) { total += info.precio * pos.cantidad; hay = true; }
  }
  return { total, hay };
}
// Resumen ligero de un portafolio para pintar su pestaña
async function resumenPestana(p) {
  const { total } = await valorPosiciones(p.operaciones);
  const capital = (typeof p.capitalInicial === 'number') ? p.capitalInicial : CAPITAL_DEFECTO;
  const valorTotal = calcularEfectivo(p) + total;
  const gpTotal = valorTotal - capital;
  return { id: p.id, nombre: p.nombre, riesgo: p.riesgo, capitalInicial: capital, valorTotal, gpTotal, gpTotalPct: capital ? (gpTotal / capital) * 100 : null };
}

async function construirEstado(idPortafolio) {
  const datos = await leerDatos();
  const cfg = leerConfig();
  const p = getPortafolio(datos, idPortafolio);
  const { posiciones, realizado } = calcularPosiciones(p.operaciones);

  let invertido = 0, valorPos = 0, cambioDia = 0;
  let hayValor = false;
  const filas = [];
  for (const pos of posiciones) {
    const info = await obtenerPrecio(pos.simbolo);
    const costoProm = pos.cantidad > 0 ? pos.costoTotal / pos.cantidad : 0;
    const precio = info.precio;
    const valor = precio != null ? precio * pos.cantidad : null;
    const gp = valor != null ? valor - pos.costoTotal : null;
    const gpPct = (gp != null && pos.costoTotal > 0) ? (gp / pos.costoTotal) * 100 : null;
    const cambioPos = (precio != null && info.cierreAnterior != null) ? (precio - info.cierreAnterior) * pos.cantidad : null;

    invertido += pos.costoTotal;
    if (valor != null) { valorPos += valor; hayValor = true; }
    if (cambioPos != null) cambioDia += cambioPos;

    filas.push({
      simbolo: pos.simbolo,
      cantidad: pos.cantidad,
      costoPromedio: costoProm,
      precioActual: precio,
      moneda: info.moneda,
      valor, gp, gpPct,
      cambioDia: cambioPos,
      spark: info.spark || [],
      error: !!info.error,
    });
  }

  const capital = (typeof p.capitalInicial === 'number') ? p.capitalInicial : CAPITAL_DEFECTO;
  const efectivo = calcularEfectivo(p);
  const valorTotal = efectivo + valorPos;
  const gpTotal = valorTotal - capital;
  const gpTotalPct = capital ? (gpTotal / capital) * 100 : null;
  const gpPosiciones = hayValor ? (valorPos - invertido) : null;

  registrarSnapshot(p, valorTotal);
  const gananciaMes = calcularGananciaMes(p, valorTotal);
  await evaluarPredicciones(p);
  guardarDatos(datos);

  const predicciones = [...p.predicciones].sort((a, b) => (b.fechaCreacion || '').localeCompare(a.fechaCreacion || ''));
  const cerradas = predicciones.filter((q) => q.estado === 'acertada' || q.estado === 'fallada');
  const aciertos = cerradas.filter((q) => q.estado === 'acertada').length;
  const tasa = cerradas.length > 0 ? (aciertos / cerradas.length) * 100 : null;

  // Pestañas: resumen de cada portafolio (el activo ya lo tenemos calculado)
  const pestanas = [];
  for (const pf of datos.portafolios) {
    if (pf.id === p.id) pestanas.push({ id: p.id, nombre: p.nombre, riesgo: p.riesgo, capitalInicial: capital, valorTotal, gpTotal, gpTotalPct });
    else pestanas.push(await resumenPestana(pf));
  }

  const _pr = await leerProyeccion();
  const proyeccion = (_pr && _pr.portafolios && _pr.portafolios[p.id]) ? { generado: _pr.generado, horizonteDias: _pr.horizonteDias || 30, ..._pr.portafolios[p.id] } : null;
  const vigilantes = await leerVigilantes();

  return {
    srv: 'mp2',
    proyeccion,
    vigilantes,
    moneda: cfg.monedaBase || 'USD',
    proveedor: (cfg.proveedorPrecios === 'finnhub' && cfg.apiKeyFinnhub) ? 'Finnhub (tu llave)' : 'Yahoo (gratis, con retraso)',
    actualizado: new Date().toLocaleString('es'),
    portafolio: p.id,
    pestanas,
    resumen: { capitalInicial: capital, invertido, valorPosiciones: valorPos, valorActual: valorPos, efectivo, valorTotal, gpTotal, gpTotalPct, gpPosiciones, realizado, cambioDia, gananciaMes },
    posiciones: filas,
    operaciones: [...p.operaciones].sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '')),
    predicciones,
    marcador: { total: cerradas.length, aciertos, tasa, abiertas: predicciones.filter((q) => q.estado === 'abierta').length },
    historico: p.snapshots || [],
  };
}

// ---------------- Utilidades HTTP ----------------
function enviarJSON(res, codigo, obj) {
  res.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function leerCuerpo(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); }
    });
  });
}
const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

// ---------------- Servidor ----------------
const PANEL_PASSWORD = process.env.PANEL_PASSWORD || '';
const SESION_TOKEN = PANEL_PASSWORD ? crypto.createHash('sha256').update('micartera|' + PANEL_PASSWORD).digest('hex') : '';
function tieneSesion(req) {
  if (!PANEL_PASSWORD) return true; // sin contrasena cuando corre local
  const cookie = req.headers.cookie || '';
  const m = cookie.match(/(?:^|;\s*)sesion=([^;]+)/);
  return !!(m && m[1] === SESION_TOKEN);
}

const servidor = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://localhost');
    const ruta = u.pathname;

    // --- Login / Logout (accesibles sin sesion) ---
    if (ruta === '/api/login' && req.method === 'POST') {
      const b = await leerCuerpo(req);
      if (PANEL_PASSWORD && b.password === PANEL_PASSWORD) {
        const esHttps = (req.headers['x-forwarded-proto'] || '').indexOf('https') !== -1;
        const seguro = esHttps ? '; Secure' : '';
        res.writeHead(200, { 'Set-Cookie': `sesion=${SESION_TOKEN}; HttpOnly; Path=/; Max-Age=2592000; SameSite=Lax${seguro}`, 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: true }));
      }
      return enviarJSON(res, 401, { ok: false, error: 'Contrasena incorrecta' });
    }
    if (ruta === '/api/logout') {
      res.writeHead(200, { 'Set-Cookie': 'sesion=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax', 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: true }));
    }

    // --- Puerta: si hay clave y no hay sesion -> mostrar login (o 401 en API) ---
    if (!tieneSesion(req)) {
      if (ruta.startsWith('/api/')) return enviarJSON(res, 401, { error: 'No autorizado' });
      return fs.readFile(path.join(CARPETA_PUBLICA, 'login.html'), (err, contenido) => {
        if (err) { res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Falta login.html'); }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(contenido);
      });
    }

    if (ruta === '/api/estado' && req.method === 'GET') {
      return enviarJSON(res, 200, await construirEstado(u.searchParams.get('portafolio')));
    }

    if (ruta === '/api/operaciones' && req.method === 'POST') {
      const b = await leerCuerpo(req);
      if (!b.simbolo || !b.cantidad || !b.precio) return enviarJSON(res, 400, { error: 'Faltan datos (simbolo, cantidad, precio).' });
      const datos = await leerDatos();
      const pf = getPortafolio(datos, b.portafolio);
      pf.operaciones.push({
        id: nuevoId(),
        simbolo: String(b.simbolo).toUpperCase().trim(),
        tipo: b.tipo === 'venta' ? 'venta' : 'compra',
        cantidad: Number(b.cantidad),
        precio: Number(b.precio),
        fecha: b.fecha || hoyISO(),
        comision: Number(b.comision) || 0,
        nota: (b.nota || '').toString().slice(0, 200),
      });
      guardarDatos(datos);
      return enviarJSON(res, 200, { ok: true });
    }

    if (ruta === '/api/operaciones' && req.method === 'DELETE') {
      const id = u.searchParams.get('id');
      const datos = await leerDatos();
      const pf = getPortafolio(datos, u.searchParams.get('portafolio'));
      pf.operaciones = pf.operaciones.filter((o) => o.id !== id);
      guardarDatos(datos);
      return enviarJSON(res, 200, { ok: true });
    }

    if (ruta === '/api/predicciones' && req.method === 'POST') {
      const b = await leerCuerpo(req);
      if (!b.simbolo || !b.direccion) return enviarJSON(res, 400, { error: 'Faltan datos (simbolo, direccion).' });
      const simbolo = String(b.simbolo).toUpperCase().trim();
      const info = await obtenerPrecio(simbolo);
      const datos = await leerDatos();
      const pf = getPortafolio(datos, b.portafolio);
      pf.predicciones.push({
        id: nuevoId(),
        simbolo,
        direccion: b.direccion === 'baja' ? 'baja' : 'sube',
        probabilidad: (b.probabilidad != null && b.probabilidad !== '') ? Number(b.probabilidad) : null,
        plazoDias: Number(b.plazoDias) || 30,
        razon: (b.razon || '').toString().slice(0, 500),
        fechaCreacion: hoyISO(),
        precioInicial: info.precio,
        estado: 'abierta',
        precioFinal: null,
        fechaEvaluacion: null,
        autor: b.autor === 'claude' ? 'claude' : 'usuario',
      });
      guardarDatos(datos);
      return enviarJSON(res, 200, { ok: true, precioInicial: info.precio });
    }

    if (ruta === '/api/predicciones' && req.method === 'DELETE') {
      const id = u.searchParams.get('id');
      const datos = await leerDatos();
      const pf = getPortafolio(datos, u.searchParams.get('portafolio'));
      pf.predicciones = pf.predicciones.filter((q) => q.id !== id);
      guardarDatos(datos);
      return enviarJSON(res, 200, { ok: true });
    }

    if (ruta === '/api/buscar' && req.method === 'GET') {
      const q = (u.searchParams.get('q') || '').trim();
      if (!q) return enviarJSON(res, 200, { resultados: [] });
      try {
        const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0`;
        const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const j = await r.json();
        const resultados = (j.quotes || [])
          .filter((x) => x.symbol && (x.shortname || x.longname))
          .map((x) => ({ simbolo: x.symbol, nombre: x.shortname || x.longname || x.symbol, tipo: x.quoteType || '', bolsa: x.exchDisp || '' }));
        return enviarJSON(res, 200, { resultados });
      } catch (e) {
        return enviarJSON(res, 200, { resultados: [] });
      }
    }

    if (ruta === '/api/precio' && req.method === 'GET') {
      const simbolo = (u.searchParams.get('simbolo') || '').toUpperCase().trim();
      if (!simbolo) return enviarJSON(res, 400, { error: 'Falta simbolo' });
      const info = await obtenerPrecio(simbolo);
      return enviarJSON(res, 200, { simbolo, precio: info.precio, moneda: info.moneda, error: !!info.error });
    }

    if (ruta === '/api/historial' && req.method === 'GET') {
      const simbolo = (u.searchParams.get('simbolo') || '').toUpperCase().trim();
      const rango = u.searchParams.get('rango') || '1d';
      if (!simbolo) return enviarJSON(res, 400, { error: 'Falta simbolo' });
      const mapa = { '1d': ['1d', '5m'], '5d': ['5d', '30m'], '1m': ['1mo', '1d'], '6m': ['6mo', '1d'], '1a': ['1y', '1wk'] };
      const [range, interval] = mapa[rango] || mapa['1d'];
      try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(simbolo)}?interval=${interval}&range=${range}`;
        const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const j = await r.json();
        const result = j && j.chart && j.chart.result && j.chart.result[0];
        if (!result) throw new Error('Sin datos');
        const ts = result.timestamp || [];
        const q = (result.indicators && result.indicators.quote && result.indicators.quote[0]) || {};
        const puntos = [];
        for (let i = 0; i < ts.length; i++) {
          const c = q.close ? q.close[i] : null;
          if (typeof c === 'number') puntos.push({ t: ts[i] * 1000, c });
        }
        const meta = result.meta || {};
        return enviarJSON(res, 200, { simbolo, rango, moneda: meta.currency || 'USD', precio: (typeof meta.regularMarketPrice === 'number' ? meta.regularMarketPrice : null), cierreAnterior: (typeof meta.chartPreviousClose === 'number' ? meta.chartPreviousClose : null), puntos });
      } catch (e) {
        return enviarJSON(res, 200, { simbolo, rango, puntos: [], error: true });
      }
    }

    // Archivos estaticos (solo desde /public)
    const archivo = ruta === '/' ? 'index.html' : decodeURIComponent(ruta.slice(1));
    const rutaAbs = path.join(CARPETA_PUBLICA, archivo);
    if (!rutaAbs.startsWith(CARPETA_PUBLICA)) {
      res.writeHead(403); return res.end('Prohibido');
    }
    fs.readFile(rutaAbs, (err, contenido) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('No encontrado');
      }
      const ext = path.extname(rutaAbs).toLowerCase();
      res.writeHead(200, { 'Content-Type': TIPOS[ext] || 'application/octet-stream' });
      res.end(contenido);
    });
  } catch (e) {
    enviarJSON(res, 500, { error: String((e && e.message) || e) });
  }
});

const PUERTO = Number(process.env.PORT) || Number(leerConfig().puerto) || 3000;
const HOST = process.env.HOST || (process.env.PORT ? '0.0.0.0' : '127.0.0.1');

function iniciar(puerto, intentos) {
  servidor.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && intentos > 0) {
      iniciar(puerto + 1, intentos - 1);
    } else {
      console.error('\n[ERROR] No se pudo iniciar el panel:', err.message, '\n');
      process.exit(1);
    }
  });
  servidor.listen(puerto, HOST, () => {
    const url = `http://localhost:${puerto}`;
    console.log('\n==================================================');
    console.log('   TU PANEL DE INVERSIONES ESTA ANDANDO');
    console.log('   ' + (USA_NUBE ? 'Modo NUBE (datos en Upstash)' : 'Modo LOCAL (datos en data.json)'));
    console.log('   Abrelo en:  ' + url);
    console.log('==================================================\n');
    if (process.platform === 'win32' && !process.env.PORT && !process.env.PANEL_NO_ABRIR) exec(`start "" "${url}"`, () => {});
  });
}

cargarInicial().then(() => iniciar(PUERTO, process.env.PORT ? 0 : 10));
