const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

const SPREADSHEET_ID = '1QLMdDyv78yY52QRj7poCcAnj9Rh9jVL-Y5EUF81xnLE';
const SHEET_NAME = 'Ingreso P1';

// 1) Credenciales desde ENV (Railway)
function getCreds() {
  const raw = process.env.google_sheets_credentials;
  if (!raw) {
    throw new Error('⚠️ ENV google_sheets_credentials no está definida');
  }
  return JSON.parse(raw);
}

// 2) Conectar con la hoja
async function getSheet() {
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
      headerValues: ['id', 'variedad', 'bloque', 'tallos', 'tamali', 'fecha', 'etapa', 'creado_iso'],
    });
  }

  await sheet.loadHeaderRow();
  return sheet;
}

// ----------- CACHÉ EN MEMORIA PARA NO LEER SIEMPRE --------------

// guardamos las filas y sus “claves” ya calculadas
let cache = {
  rows: [],        // array de rows de google-sheets
  keys: new Set(), // conjunto de llaves buildKey(...)
  loadedAt: 0      // timestamp (ms)
};

// cuánto tiempo consideramos válida la caché (ms)
const CACHE_TTL_MS = 120000; // 2 minutos

function norm(v) {
  return (v ?? '').toString().trim();
}

// llave única de un registro
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

// cargar o reutilizar cache
async function getCachedRowsAndKeys() {
  const now = Date.now();

  // si la caché está reciente, la reutilizamos
  if (cache.rows.length > 0 && now - cache.loadedAt < CACHE_TTL_MS) {
    console.log('⚡ Usando datos en caché (sin leer de Sheets)');
    return cache;
  }

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
    loadedAt: now,
  };

  console.log(`📖 Leídos ${rows.length} registros de Google Sheets (actualizando caché)`);
  return cache;
}

// 🔍 ¿Existe ya un registro con EXACTAMENTE la misma combinación?
async function existsSameRecord(data) {
  const targetKey = buildKey(data);

  const { keys, rows } = await getCachedRowsAndKeys();

  const encontrado = keys.has(targetKey);

  // debug para ver las últimas combinaciones
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

// 📝 Siempre agrega fila nueva (no borra ni actualiza)
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

  // actualizamos la caché si ya estaba cargada
  if (cache.rows.length > 0) {
    cache.rows.push(newRow);
    cache.keys.add(buildKey(rowObj));
    // no tocamos loadedAt para que siga vigente
  }
}

module.exports = {
  writeToSheet,
  existsSameRecord,
};