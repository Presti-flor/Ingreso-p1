const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

async function testGoogleSheets() {
  const creds = require('./credentials.json'); // solo local

  const serviceAccountAuth = new JWT({
    email: creds.client_email,
    key: creds.private_key.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const doc = new GoogleSpreadsheet('1JAsY9wkpp-mhawsrZjSXYeHt3BR3Kuf5KNZNM5FJLx0', serviceAccountAuth);
  await doc.loadInfo();

  let sheet = doc.sheetsByTitle['prueba'];
  if (!sheet) {
    sheet = await doc.addSheet({
      title: 'prueba',
      headerValues: ['id', 'variedad', 'bloque', 'tallos', 'tamali', 'fecha', 'etapa', 'creado_iso'],
    });
  }

  await sheet.loadHeaderRow();
  const headers = sheet.headerValues;
  console.log('📑 Encabezados actuales:', headers);

  const testId = 'TEST-0001';
  const rows = await sheet.getRows();

  const columnasId = headers.filter(h =>
    (h || '').toString().trim().toLowerCase().includes('id')
  );

  console.log('📌 Columnas consideradas como ID:', columnasId);

  const existe = rows.some(r =>
    columnasId.some(col => (r[col] ?? '').toString().trim() === testId)
  );

  if (existe) {
    console.log(`⚠️ El ID ${testId} ya existe, no se inserta`);
    return;
  }

  await sheet.addRow({
    id: testId,
    variedad: 'Rosa',
    bloque: 5,
    tallos: 30,
    tamali: 'Mediano',
    fecha: '2025-09-08',
    etapa: 'Ingreso',
    creado_iso: new Date().toISOString(),
  });

  console.log('✅ Dato de prueba insertado correctamente');
}

testGoogleSheets().catch(console.error);