// ============================================================
//  sembrar6.js — Crea el portafolio FINAL "Inversiones" ($100k) y QUITA los demás.
//  22 posiciones: flagship diversificado (91%) + sleeve de moonshots (9%).
//  Les pone lecturas alcistas a los moonshots. Lee Upstash de variables de entorno.
//    UPSTASH_REDIS_REST_URL=... UPSTASH_REDIS_REST_TOKEN=... node scripts/sembrar6.js
// ============================================================

const U = process.env.UPSTASH_REDIS_REST_URL;
const T = process.env.UPSTASH_REDIS_REST_TOKEN;
const CAP = 100000;
// [ticker, % del capital]
const ALLOC = [
  // Núcleo / motor
  ['VOO', 17], ['QQQM', 13],
  // Generales (líderes)
  ['NVDA', 5], ['MSFT', 5], ['GOOGL', 4], ['AMZN', 4], ['META', 3], ['AVGO', 3], ['LLY', 4], ['V', 3], ['COST', 2],
  // Diversificación global
  ['VXUS', 8], ['AVUV', 5], ['SCHD', 5],
  // Escudo
  ['GLDM', 6], ['BND', 4],
  // Moonshots (poca plata, alto potencial)
  ['VRDN', 1.5], ['RDW', 1.5], ['CRML', 1.5], ['SERV', 1.5], ['RCAT', 1.5], ['NNE', 1.5],
];
// Lecturas alcistas para los moonshots: simbolo -> [probabilidad, plazoDias, razon]
const LECTURAS = {
  VRDN: [58, 20, 'FDA 30-jun (ojo tiroideo); Fase 3 solida'],
  RDW: [57, 45, 'Espacio+drones; backlog record; halo del IPO de SpaceX'],
  CRML: [56, 60, 'Tierras raras; planta piloto Tanbreez; anti-China'],
  SERV: [54, 60, 'Robots delivery escalando con Uber Eats; respaldo NVIDIA'],
  RCAT: [56, 45, 'Drones; programas del Army (SRR) + plan Drone Dominance'],
  NNE: [55, 60, 'Nuclear; permiso NRC + MOU Supermicro + caja solida'],
};
const hoy = (() => { const d = new Date(), z = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()); })();

async function upstash(cmd) {
  const r = await fetch(U, { method: 'POST', headers: { Authorization: 'Bearer ' + T, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) });
  if (!r.ok) throw new Error('Upstash ' + r.status);
  return r.json();
}
async function precio(sim) {
  const u = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(sim) + '?interval=1d&range=1d';
  const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const j = await r.json();
  const px = j.chart.result[0].meta.regularMarketPrice;
  if (typeof px !== 'number') throw new Error('Sin precio para ' + sim);
  return px;
}
function nuevoId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

(async () => {
  if (!U || !T) { console.error('Faltan UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN'); process.exit(1); }

  const ops = [], predicciones = [];
  for (const [s, pct] of ALLOC) {
    const px = await precio(s);
    ops.push({ id: nuevoId(), simbolo: s, tipo: 'compra', cantidad: (CAP * pct / 100) / px, precio: px, fecha: hoy, comision: 0, nota: 'siembra inicial' });
    if (LECTURAS[s]) {
      const [prob, plazo, razon] = LECTURAS[s];
      predicciones.push({ id: nuevoId(), simbolo: s, direccion: 'sube', probabilidad: prob, plazoDias: plazo, razon, fechaCreacion: hoy, precioInicial: px, estado: 'abierta', precioFinal: null, fechaEvaluacion: null, autor: 'claude' });
    }
  }
  const inversiones = { id: 'inversiones', nombre: 'Inversiones', riesgo: 6.5, capitalInicial: CAP, operaciones: ops, predicciones, snapshots: [] };

  // REEMPLAZA todo: queda un solo portafolio.
  const salida = { version: 2, activo: 'inversiones', portafolios: [inversiones] };
  await upstash(['SET', 'cartera', JSON.stringify(salida)]);
  console.log('Sembrado OK -> SOLO "inversiones" |', ops.length, 'posiciones |', predicciones.length, 'lecturas');
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
