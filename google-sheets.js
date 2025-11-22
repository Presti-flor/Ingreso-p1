// google-sheets.js
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

// 👉 Configuración básica
const SPREADSHEET_ID = '1QLMdDyv78yY52QRj7poCcAnj9Rh9jVL-Y5EUF81xnLE';
const SHEET_NAME = 'Ingreso P1';

// ================== CREDENCIALES ==================

function getCreds() {
  const raw = process.env.google_sheets_credentials;
  if (!raw) {
    throw new Error('⚠️ ENV google_sheets_credentials no está definida');
  }
  return JSON.parse(raw);
}

// ================== CONEXIÓN A GOOGLE SHEETS ==================

let sheetInstance = null; // guardamos la hoja ya inicializada

async function getSheet() {
  // Si ya tenemos la hoja lista, la devolvemos de una vez
  if (sheetInstance) {
    return sheetInstance;
  }

  const creds = getCreds();

  const serviceAccountAuth = new JWT({
    email: creds.client_email,
    key: creds.private_key.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const doc = new GoogleSpreadsheet(SPREADSHEET_ID, serviceAccountAuth);
  await doc.loadInfo();

  let sheet = doc.sheetsByTitle[SHEET_NAME];
  if (!sheet) {
    sheet = await doc.addSheet({
      title: SHEET_NAME,
      headerValues: [
        'id',
        'variedad',
        'bloque',
        'tallos',
        'tamali',
        'fecha',
        'etapa',
        'creado_iso',
      ],
    });
  }

  await sheet.loadHeaderRow();

  sheetInstance = sheet;
  console.log('📄 Hoja de cálculo lista:', SHEET_NAME);

  return sheetInstance;
}

// ================== CACHÉ EN MEMORIA ==================

let cache = {
  rows: [],        // filas de Google Sheets
  keys: new Set(), // llaves buildKey(...)
  loadedAt: 0      // timestamp (ms) de última carga completa
};

function norm(v) {
  return (v ?? '').toString().trim();
}

// construir llave única de un registro
function buildKey({ id, variedad, bloque, tallos, tamali, fecha, etapa }) {
  return [
    norm(id),
    norm(variedad),
    norm(bloque),
    norm(tallos),
    norm(tamali),
    norm(fecha),
    norm(etapa),
  ].join('|');
}

// Carga TODA la hoja y recalcula la caché (se usa SOLO al inicio o en refresh manual)
async function loadCacheFromSheet() {
  const sheet = await getSheet();
  const rows = await sheet.getRows();
  const keys = new Set();

  for (const r of rows) {
    const raw = r._rawData || [];
    const rowData = {
      id: raw[0],
      variedad: raw[1],
      bloque: raw[2],
      tallos: raw[3],
      tamali: raw[4],
      fecha: raw[5],
      etapa: raw[6],
    };
    keys.add(buildKey(rowData));
  }

  cache = {
    rows,
    keys,
    loadedAt: Date.now(),
  };

  console.log(`📖 Cache recargada desde Google Sheets: ${rows.length} filas`);
  return cache;
}

// Asegura que la caché esté cargada (si está vacía, lee la hoja UNA sola vez)
async function ensureCacheLoaded() {
  if (cache.rows.length > 0) {
    // Ya cargada, usarla
    return cache;
  }
  // Primera vez (o después de un refresh manual)
  return await loadCacheFromSheet();
}

// ================== API PÚBLICA ==================

// 🔍 Verifica si existe registro exactamente igual
async function existsSameRecord(data) {
  const targetKey = buildKey(data);

  const { keys, rows } = await ensureCacheLoaded();

  const encontrado = keys.has(targetKey);

  // debug opcional: últimas combinaciones
  const total = rows.length;
  const start = Math.max(0, total - 3);
  const ultimas = rows.slice(start).map(r => {
    const raw = r._rawData || [];
    return buildKey({
      id: raw[0],
      variedad: raw[1],
      bloque: raw[2],
      tallos: raw[3],
      tamali: raw[4],
      fecha: raw[5],
      etapa: raw[6],
    });
  });

  console.log('📜 Últimas combinaciones en hoja:', ultimas);
  console.log(`🔍 existsSameRecord(${targetKey}) → ${encontrado}`);

  return encontrado;
}

// 📝 Agrega fila nueva y ACTUALIZA caché en memoria
async function writeToSheet(data) {
  const sheet = await getSheet();

  const rowObj = {
    id: data.id || new Date().getTime(),
    variedad: data.variedad,
    bloque: data.bloque,
    tallos: data.tallos,
    tamali: data.tamali,
    fecha: data.fecha || new Date().toLocaleDateString('es-ES'),
    etapa: data.etapa || '',
    creado_iso: new Date().toISOString(),
  };

  const newRow = await sheet.addRow(rowObj);
  console.log('✅ fila escrita en Sheets:', rowObj);

  // Si la caché ya estaba cargada, la mantenemos al día sin recargar todo
  if (cache.rows.length > 0) {
    cache.rows.push(newRow);
    cache.keys.add(buildKey(rowObj));
    // no cambiamos loadedAt porque no es una recarga completa
  }

  return newRow;
}

// 🔄 Refresh manual de caché (para cuando alguien toca la hoja directamente en Google)
async function refreshCache() {
  console.log('🔄 Forzando recarga de caché desde Google Sheets...');
  const c = await loadCacheFromSheet();
  return {
    totalRows: c.rows.length,
    loadedAt: c.loadedAt,
  };
}

module.exports = {
  writeToSheet,
  existsSameRecord,
  refreshCache,
};