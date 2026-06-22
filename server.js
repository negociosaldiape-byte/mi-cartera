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

function datosVacios() {
  return { operaciones: [], predicciones: [], snapshots: [] };
}
function normaliza(d) {
  d = d || {};
  d.operaciones = d.operaciones || [];
  d.predicciones = d.predicciones || [];
  d.snapshots = d.snapshots || [];
  return d;
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

function leerDatos() {
  return USA_NUBE ? normaliza(DATOS) : leerArchivo();
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

function registrarSnapshot(datos, valorActual) {
  if (valorActual == null || isNaN(valorActual)) return;
  const hoy = hoyISO();
  const existe = datos.snapshots.find((s) => s.fecha === hoy);
  if (existe) existe.valorTotal = valorActual;
  else datos.snapshots.push({ fecha: hoy, valorTotal: valorActual });
  datos.snapshots.sort((a, b) => a.fecha.localeCompare(b.fecha));
}

function calcularGananciaMes(datos, valorActual) {
  const hoy = hoyISO();
  const inicioMes = hoy.slice(0, 8) + '01';
  const anteriores = datos.snapshots.filter((s) => s.fecha < hoy);
  if (!anteriores.length) return { disponible: false };

  const previosAlMes = anteriores.filter((s) => s.fecha < inicioMes);
  let base;
  if (previosAlMes.length) {
    base = previosAlMes[previosAlMes.length - 1].valorTotal;
  } else {
    const delMes = datos.snapshots.filter((s) => s.fecha >= inicioMes && s.fecha < hoy);
    if (!delMes.length) return { disponible: false };
    base = delMes[0].valorTotal;
  }
  // Restamos el dinero NUEVO metido este mes (no es ganancia, es aporte).
  let netoAportado = 0;
  for (const op of datos.operaciones) {
    if ((op.fecha || '') >= inicioMes) {
      const bruto = (Number(op.cantidad) || 0) * (Number(op.precio) || 0);
      netoAportado += op.tipo === 'venta' ? -bruto : (bruto + (Number(op.comision) || 0));
    }
  }
  return { disponible: true, valor: valorActual - base - netoAportado };
}

// ---------------- Evaluacion de predicciones ----------------
async function evaluarPredicciones(datos) {
  const ahora = new Date();
  for (const p of datos.predicciones) {
    if (p.estado !== 'abierta') continue;
    if (p.precioInicial == null) continue;
    const creada = new Date(p.fechaCreacion + 'T00:00:00');
    const vence = new Date(creada.getTime() + (Number(p.plazoDias) || 0) * 86400000);
    if (ahora >= vence) {
      const info = await obtenerPrecio(p.simbolo);
      if (info.precio == null) continue; // se intentara de nuevo luego
      p.precioFinal = info.precio;
      p.fechaEvaluacion = hoyISO();
      const subio = info.precio > p.precioInicial;
      const bajo = info.precio < p.precioInicial;
      if (p.direccion === 'sube') p.estado = subio ? 'acertada' : 'fallada';
      else p.estado = bajo ? 'acertada' : 'fallada';
    }
  }
}

// ---------------- Estado completo para el panel ----------------
async function construirEstado() {
  const datos = leerDatos();
  const cfg = leerConfig();
  const { posiciones, realizado } = calcularPosiciones(datos.operaciones);

  let invertido = 0, valorActual = 0, cambioDia = 0;
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
    if (valor != null) { valorActual += valor; hayValor = true; }
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

  const valorParaTotales = hayValor ? valorActual : null;
  const gpTotal = valorParaTotales != null ? valorParaTotales - invertido : null;
  const gpTotalPct = (gpTotal != null && invertido > 0) ? (gpTotal / invertido) * 100 : null;

  if (valorParaTotales != null) registrarSnapshot(datos, valorParaTotales);
  const gananciaMes = calcularGananciaMes(datos, valorParaTotales);
  await evaluarPredicciones(datos);
  guardarDatos(datos);

  const predicciones = [...datos.predicciones].sort((a, b) => (b.fechaCreacion || '').localeCompare(a.fechaCreacion || ''));
  const cerradas = predicciones.filter((p) => p.estado === 'acertada' || p.estado === 'fallada');
  const aciertos = cerradas.filter((p) => p.estado === 'acertada').length;
  const tasa = cerradas.length > 0 ? (aciertos / cerradas.length) * 100 : null;

  return {
    moneda: cfg.monedaBase || 'USD',
    proveedor: (cfg.proveedorPrecios === 'finnhub' && cfg.apiKeyFinnhub) ? 'Finnhub (tu llave)' : 'Yahoo (gratis, con retraso)',
    actualizado: new Date().toLocaleString('es'),
    resumen: { invertido, valorActual: valorParaTotales, gpTotal, gpTotalPct, realizado, cambioDia, gananciaMes },
    posiciones: filas,
    operaciones: [...datos.operaciones].sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '')),
    predicciones,
    marcador: { total: cerradas.length, aciertos, tasa, abiertas: predicciones.filter((p) => p.estado === 'abierta').length },
    historico: datos.snapshots || [],
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
      return enviarJSON(res, 200, await construirEstado());
    }

    if (ruta === '/api/operaciones' && req.method === 'POST') {
      const b = await leerCuerpo(req);
      if (!b.simbolo || !b.cantidad || !b.precio) return enviarJSON(res, 400, { error: 'Faltan datos (simbolo, cantidad, precio).' });
      const datos = leerDatos();
      datos.operaciones.push({
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
      const datos = leerDatos();
      datos.operaciones = datos.operaciones.filter((o) => o.id !== id);
      guardarDatos(datos);
      return enviarJSON(res, 200, { ok: true });
    }

    if (ruta === '/api/predicciones' && req.method === 'POST') {
      const b = await leerCuerpo(req);
      if (!b.simbolo || !b.direccion) return enviarJSON(res, 400, { error: 'Faltan datos (simbolo, direccion).' });
      const simbolo = String(b.simbolo).toUpperCase().trim();
      const info = await obtenerPrecio(simbolo);
      const datos = leerDatos();
      datos.predicciones.push({
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
      const datos = leerDatos();
      datos.predicciones = datos.predicciones.filter((p) => p.id !== id);
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
