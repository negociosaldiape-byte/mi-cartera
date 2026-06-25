// ============================================================
//  trump.js — Vigía de Trump
//  Monitorea Truth Social, Google News y la Casa Blanca
//  buscando menciones de empresas, tickers o personas
//  asociadas a la bolsa en declaraciones de Trump.
//
//  Detección en 3 capas: (1) $TICKER explícito, (2) mapa rápido de ~80
//  nombres/apodos conocidos, (3) RESOLUCIÓN DINÁMICA: cualquier nombre
//  propio que diga Trump se busca en Yahoo Finance y, si cotiza, se
//  convierte a su ticker automáticamente. Así NO depende solo del mapa.
//  Escribe en Upstash: clave 'trump'
//  Envía email si Trump menciona una acción de tu cartera.
//
//  Variables requeridas:
//    UPSTASH_REDIS_REST_URL
//    UPSTASH_REDIS_REST_TOKEN
//    RESEND_API_KEY   (opcional, para email)
//    ALERT_EMAIL      (opcional, para email)
// ============================================================

const U = process.env.UPSTASH_REDIS_REST_URL;
const T = process.env.UPSTASH_REDIS_REST_TOKEN;
const RESEND = process.env.RESEND_API_KEY;
const EMAIL = process.env.ALERT_EMAIL;

async function upstash(cmd) {
  const r = await fetch(U, { method: 'POST', headers: { Authorization: 'Bearer ' + T, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) });
  if (!r.ok) throw new Error('Upstash ' + r.status);
  return r.json();
}

// ── Mapeo nombre/persona/producto → tickers ──────────────────────────────────
// Cuanto más completo, más menciones se detectan.
const MAPA = {
  // Big tech
  'apple': ['AAPL'], 'iphone': ['AAPL'], 'tim cook': ['AAPL'], 'mac': ['AAPL'], 'ios': ['AAPL'],
  'nvidia': ['NVDA'], 'jensen huang': ['NVDA'], 'jensen': ['NVDA'], 'chips': ['NVDA'],
  'microsoft': ['MSFT'], 'satya nadella': ['MSFT'], 'azure': ['MSFT'], 'windows': ['MSFT'], 'openai': ['MSFT'],
  'google': ['GOOGL'], 'alphabet': ['GOOGL'], 'youtube': ['GOOGL'], 'sundar pichai': ['GOOGL'],
  'amazon': ['AMZN'], 'jeff bezos': ['AMZN'], 'andy jassy': ['AMZN'], 'prime': ['AMZN'], 'aws': ['AMZN'],
  'meta': ['META'], 'facebook': ['META'], 'instagram': ['META'], 'whatsapp': ['META'],
  'mark zuckerberg': ['META'], 'zuckerberg': ['META'],
  'tesla': ['TSLA'], 'elon musk': ['TSLA', 'DOGE'], 'spacex': ['TSLA'],
  'dell': ['DELL'], 'michael dell': ['DELL'],
  'broadcom': ['AVGO'],
  // Pharma / salud
  'eli lilly': ['LLY'], 'lilly': ['LLY'], 'ozempic': ['LLY', 'NVO'],
  'mounjaro': ['LLY'], 'wegovy': ['LLY', 'NVO'], 'semaglutide': ['LLY', 'NVO'],
  'pfizer': ['PFE'], 'moderna': ['MRNA'], 'johnson & johnson': ['JNJ'],
  // Servicios financieros
  'visa': ['V'], 'mastercard': ['MA'],
  'jpmorgan': ['JPM'], 'jp morgan': ['JPM'], 'jamie dimon': ['JPM'],
  'goldman sachs': ['GS'], 'goldman': ['GS'],
  'blackrock': ['BLK'], 'larry fink': ['BLK'],
  // Retail / consumo
  'costco': ['COST'], 'walmart': ['WMT'], 'target': ['TGT'],
  'home depot': ['HD'], 'amazon prime': ['AMZN'],
  // Autos
  'ford': ['F'], 'general motors': ['GM'], 'gm': ['GM'], 'stellantis': ['STLA'],
  // Defensa
  'boeing': ['BA'],
  'lockheed martin': ['LMT'], 'lockheed': ['LMT'],
  'raytheon': ['RTX'],
  'northrop grumman': ['NOC'], 'northrop': ['NOC'],
  'general dynamics': ['GD'],
  'palantir': ['PLTR'],
  // Energía
  'exxon': ['XOM'], 'exxonmobil': ['XOM'],
  'chevron': ['CVX'],
  'coal': ['ARCH', 'BTU'],
  'oil': ['XOM', 'CVX'],
  // Acero / industrial
  'united states steel': ['X'], 'us steel': ['X'], 'u.s. steel': ['X'],
  'steel': ['X', 'NUE'],
  'aluminum': ['AA'],
  // Crypto / fintech
  'bitcoin': ['COIN', 'MSTR', 'MARA'], 'crypto': ['COIN'],
  'coinbase': ['COIN'], 'microstrategy': ['MSTR'],
  // Media / entretenimiento
  'disney': ['DIS'], 'walt disney': ['DIS'],
  'netflix': ['NFLX'], 'fox': ['FOX', 'FOXA'],
  'truth social': ['DJT'], 'trump media': ['DJT'],
  // Del portafolio del usuario
  'serve robotics': ['SERV'], 'serve': ['SERV'],
  'red cat': ['RCAT'], 'redcat': ['RCAT'],
  'nuclear': ['NNE', 'SMR'], 'small nuclear': ['NNE'],
  'rare earth': ['CRML', 'MP'], 'rare earths': ['CRML', 'MP'],
  'redwire': ['RDW'],
  // Temas estructurales de Trump
  'semiconductor': ['NVDA', 'AVGO', 'INTC', 'AMD'],
  'drone': ['RCAT', 'AVAV'], 'drones': ['RCAT', 'AVAV'],
  'artificial intelligence': ['NVDA', 'MSFT', 'GOOGL'],
  'made in usa': [], 'made in america': [],
};

// Palabras que parecen nombre propio pero NO son empresas (evita búsquedas inútiles).
const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'of', 'in', 'on', 'at', 'to', 'for', 'with',
  'trump', 'donald', 'president', 'biden', 'harris', 'obama', 'america', 'american', 'americans',
  'united', 'states', 'usa', 'us', 'u.s.', 'u.s', 'china', 'chinese', 'russia', 'mexico', 'canada',
  'europe', 'european', 'washington', 'white', 'house', 'congress', 'senate', 'democrat', 'democrats',
  'republican', 'republicans', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
  'sunday', 'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september',
  'october', 'november', 'december', 'great', 'big', 'new', 'make', 'making', 'god', 'bless',
  'truth', 'social', 'news', 'fake', 'border', 'deal', 'tax', 'tariff', 'tariffs', 'billion',
  'million', 'trillion', 'dollar', 'dollars', 'percent', 'today', 'tonight', 'now', 'this', 'that',
  'we', 'i', 'they', 'he', 'she', 'it', 'my', 'our', 'your', 'their', 'will', 'would', 'is', 'are',
  'was', 'were', 'has', 'have', 'had', 'do', 'did', 'says', 'said', 'report', 'reports', 'breaking',
  'crooked', 'sleepy', 'radical', 'left', 'right', 'fed', 'federal', 'reserve', 'supreme', 'court',
  'department', 'secretary', 'governor', 'senator', 'wall', 'street', 'main', 'first', 'last']);

// Caché de búsquedas Yahoo (nombre → ticker o null), se rellena durante la corrida.
const cacheNombre = new Map();

// Buscar el ticker de un nombre de empresa en Yahoo Finance (el mismo buscador del panel).
async function buscarTicker(nombre) {
  const clave = nombre.toLowerCase();
  if (cacheNombre.has(clave)) return cacheNombre.get(clave);
  try {
    const url = 'https://query1.finance.yahoo.com/v1/finance/search?q=' + encodeURIComponent(nombre) + '&quotesCount=3&newsCount=0';
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) { cacheNombre.set(clave, null); return null; }
    const j = await r.json();
    const q = (j.quotes || []).find(x => x.symbol &&
      (x.quoteType === 'EQUITY' || x.quoteType === 'ETF') &&
      (x.shortname || x.longname));
    if (!q) { cacheNombre.set(clave, null); return null; }
    // Confirmar que el nombre de Trump aparece en el nombre real de la empresa (evita falsos positivos).
    const oficial = (q.shortname || q.longname || '').toLowerCase();
    const palabra = clave.split(' ')[0];
    const ticker = oficial.includes(palabra) ? q.symbol.toUpperCase() : null;
    cacheNombre.set(clave, ticker);
    return ticker;
  } catch { cacheNombre.set(clave, null); return null; }
}

// Extraer candidatos a nombre propio: secuencias de palabras Capitalizadas (1-3 palabras).
function extraerNombresPropios(texto) {
  const out = new Set();
  // Cortar en frases (. ! ? : ; — saltos) para no pegar nombres de oraciones distintas.
  for (const frase of texto.split(/[.!?:;\n]|—| - /)) {
    for (const m of frase.matchAll(/\b([A-Z][a-zA-Z&'-]+(?:\s+(?:[A-Z][a-zA-Z&'-]+|of|and|&)){0,2})\b/g)) {
      const palabras = m[1].trim().split(/\s+/);
      const utiles = palabras.filter(p => !STOP.has(p.toLowerCase()) && p.length > 2);
      if (!utiles.length) continue;
      // Saltar candidatos de UNA sola palabra TODA en mayúsculas (énfasis de Trump, no nombre).
      if (utiles.length === 1 && utiles[0] === utiles[0].toUpperCase() && utiles[0].length > 3) continue;
      out.add(utiles.join(' '));
      if (utiles.length > 1) out.add(utiles[0]); // "Caterpillar Inc" → también "Caterpillar"
    }
  }
  return [...out];
}

// Detectar tickers en texto (mapa rápido + $TICKER + resolución dinámica Yahoo)
async function detectarTickers(texto) {
  const t = texto.toLowerCase();
  const enc = new Set();
  // 1) $TICKER explícito
  for (const m of texto.matchAll(/\$([A-Z]{1,5}(?:\.[AB])?)\b/g)) enc.add(m[1]);
  // 2) Nombres/apodos conocidos del mapa (rápido, sin red)
  for (const [nombre, tickers] of Object.entries(MAPA)) {
    if (t.includes(nombre)) for (const tk of tickers) if (tk) enc.add(tk);
  }
  // 3) Resolución dinámica: cualquier nombre propio → Yahoo lo convierte a ticker
  const candidatos = extraerNombresPropios(texto);
  for (const nombre of candidatos) {
    if (cacheNombre.get(nombre.toLowerCase()) === null) continue; // ya se sabe que no es empresa
    const tk = await buscarTicker(nombre);
    if (tk) enc.add(tk);
  }
  return [...enc];
}

// Sentimiento simple basado en vocabulario de Trump
function sentimiento(texto) {
  const t = texto.toLowerCase();
  const bull = ['great', 'fantastic', 'love', 'buy american', 'invest', 'boom', 'winning', 'tremendous',
    'beautiful', 'best', 'amazing', 'incredible', 'deal', 'jobs', 'bringing back', 'made in usa',
    'making america great', 'strong', 'great company', 'big announcement', 'proud'];
  const bear = ['bad', 'terrible', 'corrupt', 'failing', 'bankrupt', 'dishonest', 'unfair',
    'sanction', 'ban', 'enemy', 'boycott', 'overpriced', 'investigate', 'witch hunt'];
  const attention = ['tariff', 'tariffs', 'tax', 'tax', 'penalty', 'trade war'];
  const b = bull.filter(w => t.includes(w)).length;
  const d = bear.filter(w => t.includes(w)).length;
  const n = attention.filter(w => t.includes(w)).length;
  if (b > d + n) return 'bullish';
  if (d > b) return 'bearish';
  if (n > 0) return 'atención';
  return 'neutral';
}

// Limpiar HTML de RSS
function stripHtml(html) {
  return (html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

// Fetch RSS → array de items
async function fetchRSS(url) {
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MSIE 9.0; Windows NT 6.1; Trident/5.0)', Accept: 'application/rss+xml,application/xml,text/xml,*/*' },
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) { console.warn('  RSS ' + r.status + ' → ' + url.slice(0, 80)); return []; }
    const xml = await r.text();
    const items = [];
    for (const m of xml.matchAll(/<item[^>]*>([\s\S]*?)<\/item>/g)) {
      const it = m[1];
      const title = stripHtml(it.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)?.[1] || '');
      const desc  = stripHtml(it.match(/<description[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/)?.[1] || '');
      const link  = (it.match(/<link[^>]*>([^<]*)<\/link>/)?.[1] || it.match(/<link\s+href="([^"]+)"/)?.[1] || '').trim();
      const pub   = (it.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/)?.[1] || '').trim();
      const guid  = (it.match(/<guid[^>]*>([\s\S]*?)<\/guid>/)?.[1] || link).trim();
      items.push({ title, desc, link, pubDate: pub ? new Date(pub).toISOString() : new Date().toISOString(), guid: guid || link });
    }
    return items;
  } catch (e) {
    console.warn('  RSS error:', url.slice(0, 60), '—', e.message);
    return [];
  }
}

// Email de alerta
async function enviarAlerta(menciones) {
  if (!RESEND || !EMAIL || !menciones.length) return;
  const colorImp = { bullish: '#1a9e75', bearish: '#d8403a', 'atención': '#e5a000', neutral: '#888' };
  const tickersUrgentes = [...new Set(menciones.flatMap(m => m.enMiCartera))];
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;color:#1a1a2e">
    <h2 style="margin:0 0 4px">🇺🇸 Trump mencionó acciones de tu cartera</h2>
    <p style="color:#666;margin:0 0 20px;font-size:14px">Cuando Trump habla de una empresa, el mercado reacciona. Estate atento.</p>
    ${menciones.map(m => `
      <div style="border-left:4px solid ${colorImp[m.impacto]||'#888'};padding:10px 16px;margin:12px 0;background:#f7f8fc;border-radius:0 8px 8px 0">
        <div style="font-weight:700;font-size:16px;color:${colorImp[m.impacto]||'#333'}">${m.enMiCartera.join(' · ')} &nbsp;<span style="font-weight:400;font-size:13px">${m.impacto.toUpperCase()}</span></div>
        <div style="font-size:12px;color:#888;margin:2px 0">${new Date(m.fecha).toLocaleString('es')} · ${m.fuenteNombre}</div>
        <div style="margin:8px 0;font-size:15px">${m.titulo}</div>
        ${m.tickers.length > m.enMiCartera.length ? `<div style="font-size:12px;color:#888">También menciona: ${m.tickers.filter(t => !m.enMiCartera.includes(t)).join(', ')}</div>` : ''}
        ${m.url ? `<a href="${m.url}" style="color:#6c8cff;font-size:13px;display:block;margin-top:8px">Ver fuente →</a>` : ''}
      </div>`).join('')}
    <p style="color:#999;font-size:12px;margin-top:24px">Análisis automático, no asesoría financiera. Fuentes: Truth Social, Casa Blanca, Google News.</p>
  </div>`;
  try {
    const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + RESEND, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: 'Mi Cartera <onboarding@resend.dev>', to: [EMAIL], subject: `🇺🇸 Trump habló de: ${tickersUrgentes.join(', ')}`, html }) });
    const j = await r.json();
    if (!r.ok) console.warn('Resend:', JSON.stringify(j));
    else console.log('📧 Email enviado:', tickersUrgentes.join(', '));
  } catch (e) { console.warn('Email error:', e.message); }
}

// ── MAIN ─────────────────────────────────────────────────────────────────────
(async () => {
  if (!U || !T) { console.error('Faltan UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN'); process.exit(1); }

  // Estado previo (para no re-alertar el mismo artículo)
  const prev = JSON.parse((await upstash(['GET', 'trump'])).result || '{}');
  const yaVistos = new Set(prev.vistos || []);
  const mencionesAntes = (prev.menciones || []);

  // Acciones del usuario (para detectar cuáles están en la cartera)
  const blob = JSON.parse((await upstash(['GET', 'cartera'])).result || '{}');
  const portafolios = Array.isArray(blob.portafolios) && blob.portafolios.length
    ? blob.portafolios : [{ operaciones: blob.operaciones || [] }];
  const misAcciones = new Set(
    portafolios.flatMap(pf => (pf.operaciones || []).map(op => (op.simbolo || '').toUpperCase()))
  );

  // ── Fuentes RSS ───────────────────────────────────────────────────────────
  const FUENTES = [
    // Truth Social de Trump (feed oficial público)
    { id: 'ts',   url: 'https://truthsocial.com/@realDonaldTrump.rss',                                                                                                nombre: 'Truth Social' },
    // Casa Blanca — comunicados, discursos y declaraciones
    { id: 'wh',   url: 'https://www.whitehouse.gov/briefing-room/statements-releases/feed/',                                                                          nombre: 'Casa Blanca' },
    // Google News: Trump + mercado
    { id: 'gn1',  url: 'https://news.google.com/rss/search?q=Trump+stock+market+company&hl=en-US&gl=US&ceid=US:en&tbs=qdr:d',                                       nombre: 'Google News' },
    // Google News: Trump + aranceles + empresas
    { id: 'gn2',  url: 'https://news.google.com/rss/search?q=%22Trump%22+%22trade+deal%22+OR+%22tariff%22+company&hl=en-US&gl=US&ceid=US:en&tbs=qdr:d',             nombre: 'Google News (trade)' },
    // Google News: anuncios de fábricas/inversiones
    { id: 'gn3',  url: 'https://news.google.com/rss/search?q=Trump+announces+company+OR+factory+OR+investment+OR+billion&hl=en-US&gl=US&ceid=US:en&tbs=qdr:d',      nombre: 'Google News (anuncios)' },
    // Google News: Trump + nombre de acción
    { id: 'gn4',  url: 'https://news.google.com/rss/search?q=Trump+says+stock+OR+shares+OR+invest+OR+buy+American&hl=en-US&gl=US&ceid=US:en&tbs=qdr:d',             nombre: 'Google News (acciones)' },
  ];

  const nuevas = [];
  const corte48h = Date.now() - 48 * 60 * 60 * 1000;

  for (const fuente of FUENTES) {
    console.log('  Revisando:', fuente.nombre);
    const items = await fetchRSS(fuente.url);
    for (const item of items) {
      // ID único y estable por artículo
      const rawId = (item.guid || item.link || item.title).slice(0, 150);
      const id = Buffer.from(rawId).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 32);
      if (!id || yaVistos.has(id)) continue;
      // Solo últimas 48h
      if (item.pubDate && new Date(item.pubDate).getTime() < corte48h) continue;

      const texto = item.title + ' ' + item.desc;
      const tickers = await detectarTickers(texto);
      if (!tickers.length) continue;

      yaVistos.add(id);
      const imp = sentimiento(texto);
      const enMiCartera = tickers.filter(tk => misAcciones.has(tk));

      nuevas.push({
        id,
        fuente: fuente.id,
        fuenteNombre: fuente.nombre,
        fecha: item.pubDate || new Date().toISOString(),
        titulo: item.title.slice(0, 250),
        url: item.link,
        tickers,
        impacto: imp,
        enMiCartera,
      });
    }
  }

  // Unir con historial reciente (≤72h, máx 60 entradas)
  const viejas = mencionesAntes
    .filter(m => new Date(m.fecha).getTime() > Date.now() - 72 * 60 * 60 * 1000)
    .slice(0, 50);
  const todas = [...nuevas, ...viejas]
    .sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
    .slice(0, 60);

  // Email si hay nuevas menciones de MIS acciones
  const alertar = nuevas.filter(m => m.enMiCartera.length > 0);
  await enviarAlerta(alertar);

  // Stats de resumen
  const ahora = Date.now();
  const rec24h = todas.filter(m => new Date(m.fecha).getTime() > ahora - 24 * 3600000);
  const tickers24h = [...new Set(rec24h.flatMap(m => m.tickers))];
  const enCarteraHoy = [...new Set(rec24h.flatMap(m => m.enMiCartera))];

  const resultado = {
    generado: new Date().toISOString(),
    menciones: todas,
    vistos: [...yaVistos].slice(-2000),
    stats: {
      total: todas.length,
      ultimas24h: rec24h.length,
      tickers24h: tickers24h.slice(0, 15),
      enCarteraHoy,
      nuevasEstaVez: nuevas.length,
    },
  };

  await upstash(['SET', 'trump', JSON.stringify(resultado)]);
  console.log(`✅ Trump: ${nuevas.length} nuevas menciones (${alertar.length} de tu cartera). Total 72h: ${todas.length}. Tickers hoy: ${tickers24h.slice(0, 8).join(', ') || 'ninguno'}`);
})().catch(e => { console.error(e); process.exit(1); });
