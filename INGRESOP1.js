const express = require("express");
const { Pool } = require("pg");
const { writeToSheet, existsSameRecord } = require("./google-sheets"); // 👈 importante

const app = express();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // en Railway casi siempre hace falta
});

app.use(express.json());

// Lista de IPs autorizadas (para el QR, no para exportar)
const authorizedIPs = [
  "190.60.35.50",
  "186.102.115.133",
  "186.102.47.124",
  "186.102.51.69",
  "190.61.45.230",
  "192.168.10.23",
  "192.168.10.1",
  "186.102.62.30",
  "186.102.25.201",
];

// Normaliza IP (Railway mete varias separadas por coma)
function validateIP(req) {
  const raw = req.headers["x-forwarded-for"] || req.connection.remoteAddress || "";
  const clientIP = raw.split(",")[0].trim();
  console.log("📡 IP del cliente:", clientIP);
  return authorizedIPs.includes(clientIP);
}

// 👉 Guarda también en PostgreSQL (solo INSERT, sin ON CONFLICT)
async function saveToPostgres({ id, variedad, bloque, tallos, tamali, fecha, etapa }) {
  await pool.query(
    `INSERT INTO registros (id, variedad, bloque, tallos, tamali, fecha, etapa)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, variedad, bloque, tallos, tamali, fecha, etapa]
  );

  console.log(`💾 Guardado en PostgreSQL: id=${id}, variedad=${variedad}, bloque=${bloque}`);
}

// Lógica principal: valida + evita doble escaneo + guarda en Sheets + guarda en DB
async function processAndSaveData({ id, variedad, bloque, tallos, tamali, fecha, etapa, force }) {
  if (!id) throw new Error("Falta el parámetro id");
  if (!variedad || !bloque || !tallos || !tamali) {
    throw new Error("Faltan datos obligatorios: variedad, bloque, tallos, tamali");
  }

  const tallosNum = parseInt(tallos);
  if (isNaN(tallosNum)) {
    throw new Error("El parámetro tallos debe ser un número válido");
  }

  const fechaProcesada = fecha || new Date().toISOString().slice(0, 10);

  // ⚠️ Solo verificamos duplicado si NO viene force=true
  if (!force) {
    const yaExiste = await existsSameRecord({
      id,
      variedad,
      bloque,
      tallos: tallosNum,
      tamali,
      fecha: fechaProcesada,
      etapa,
    });

    if (yaExiste) {
      const err = new Error("Este código QR con estos datos ya fue registrado (doble escaneo).");
      err.code = "DUPLICATE";
      throw err;
    }
  }

  // 1️⃣ Guardar en Google Sheets (hoja del día)
  await writeToSheet({
    id,
    variedad,
    bloque,
    tallos: tallosNum,
    tamali,
    fecha: fechaProcesada,
    etapa,
  });

  // 2️⃣ Guardar en PostgreSQL (base histórica)
  await saveToPostgres({
    id,
    variedad,
    bloque,
    tallos: tallosNum,
    tamali,
    fecha: fechaProcesada,
    etapa,
  });
}

/* ✅ NUEVO ENDPOINT: exportar histórico completo desde PostgreSQL
   IMPORTANTE: aquí NO usamos validateIP, porque lo quiere llamar Google Sheets
*/
app.get("/api/exportar", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM registros ORDER BY fecha DESC");
    res.json(result.rows);
  } catch (err) {
    console.error("❌ Error al exportar datos:", err);
    res.status(500).json({ error: err.message });
  }
});
// ❌ Eliminar un registro de la base PostgreSQL
app.post("/api/eliminar", async (req, res) => {
  try {
    const { id, variedad, bloque, tallos, tamali, fecha, etapa } = req.body;

    if (!id || !variedad || !bloque || !tallos || !tamali || !fecha) {
      return res
        .status(400)
        .json({ ok: false, error: "Faltan datos para identificar el registro" });
    }

    const result = await pool.query(
      `DELETE FROM registros
       WHERE id = $1
         AND variedad = $2
         AND bloque = $3
         AND tallos = $4
         AND tamali = $5
         AND fecha = $6
         AND (etapa = $7 OR $7 IS NULL)`,
      [id, variedad, bloque, tallos, tamali, fecha, etapa || null]
    );

    console.log(`🗑 Eliminados en PostgreSQL: ${result.rowCount} filas`);

    res.json({ ok: true, eliminados: result.rowCount });
  } catch (err) {
    console.error("❌ Error en /api/eliminar:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});
// GET (para el QR)
app.get("/api/registrar", async (req, res) => {
  try {
    if (!validateIP(req)) {
      return res.status(403).send(`
        <html lang="es">
        <head><meta charset="UTF-8"><title>Acceso denegado</title></head>
        <body style="font-family:sans-serif; text-align:center; margin-top:60px;">
          <h1 style="font-size:60px; color:#dc2626;">🚫 IP no autorizada</h1>
        </body>
        </html>
      `);
    }

    const { id, variedad, bloque, tallos, tamali, fecha, etapa, force } = req.query;
    const forceFlag = force === "true" || force === "1";

    if (!id || !variedad || !bloque || !tallos || !tamali) {
      return res.status(400).send(`
        <html lang="es">
        <head><meta charset="UTF-8"><title>Faltan datos</title></head>
        <body style="font-family:sans-serif; text-align:center; margin-top:60px;">
          <h1 style="font-size:60px; color:#dc2626;">⚠️ Faltan parámetros en la URL</h1>
        </body>
        </html>
      `);
    }

    await processAndSaveData({
      id,
      variedad,
      bloque,
      tallos,
      tamali,
      fecha,
      etapa,
      force: forceFlag,
    });

    // ✅ MENSAJE DE REGISTRO OK
    res.send(`
      <html lang="es">
      <head><meta charset="UTF-8"><title>Registro exitoso</title></head>
      <body style="
        font-family:sans-serif;
        text-align:center;
        margin-top:80px;
        background-color:#ffffff;
      ">
        <h1 style="font-size:100px; color:#22c55e; margin-top:200px; margin-bottom:20px;">
          ✅ REGISTRO GUARDADO
        </h1>
        <p style="font-size:32px; opacity:0.9;">
          Variedad: <b>${variedad}</b> &nbsp; | &nbsp;
          Bloque: <b>${bloque}</b> &nbsp; | &nbsp;
          Tallos: <b>${tallos}</b>
        </p>
      </body>
      </html>
    `);
  } catch (err) {
    console.error("❌ Error en /api/registrar:", err.message);

    const esDoble =
      err.code === "DUPLICATE" ||
      err.message.includes("doble escaneo") ||
      err.message.includes("ya fue registrado");

    if (esDoble) {
      const { id, variedad, bloque, tallos, tamali, fecha, etapa } = req.query;
      const currentUrl = req.originalUrl;
      const separator = currentUrl.includes("?") ? "&" : "?";
      const newUrl = `${currentUrl}${separator}force=true`;

      return res.status(400).send(`
        <html lang="es">
        <head><meta charset="UTF-8"><title>Doble escaneo</title></head>
        <body style="
          font-family:sans-serif;
          text-align:center;
          margin-top:80px;
          background-color:#b9deff;
          color:white;
        ">
          <h1 style="font-size:72px; color:#f41606; margin-bottom:20px;">
            ⚠️ ESTE CÓDIGO YA FUE ESCANEADO
          </h1>
          <p style="font-size:30px; opacity:0.9;">
            Variedad: <b>${variedad}</b> &nbsp; | &nbsp;
            Bloque: <b>${bloque}</b> &nbsp; | &nbsp;
            Tallos: <b>${tallos}</b>
          </p>
          <button
            onclick="window.location.href='${newUrl}'"
            style="
              margin-top:80px;
              padding:20px 80px;
              font-size:55px;
              background-color:#22c55e;
              color:white;
              border:none;
              border-radius:31px;
              cursor:pointer;
            ">
            ✅ Registrar de todas formas
          </button>
        </body>
        </html>
      `);
    }

    // Otros errores
    res.status(400).send(`
      <html lang="es">
      <head><meta charset="UTF-8"><title>Error</title></head>
      <body style="
        font-family:sans-serif;
        text-align:center;
        margin-top:80px;
        background-color:#111827;
        color:white;
      ">
        <h1 style="font-size:72px; color:#dc2626; margin-bottom:20px;">
          ❌ ERROR EN EL REGISTRO
        </h1>
        <p style="font-size:30px; opacity:0.9;">
          ${err.message}
        </p>
      </body>
      </html>
    `);
  }
});

// POST (opcional)
app.post("/api/registrar", async (req, res) => {
  try {
    if (!validateIP(req)) {
      return res.status(403).json({ mensaje: "Acceso denegado: IP no autorizada" });
    }

    const { id, variedad, bloque, tallos, tamali, fecha, etapa, force } = req.body;
    const forceFlag =
      force === true || force === "true" || force === 1 || force === "1";

    await processAndSaveData({
      id,
      variedad,
      bloque,
      tallos,
      tamali,
      fecha,
      etapa,
      force: forceFlag,
    });

    res.json({ mensaje: "✅ Registro guardado" });
  } catch (err) {
    console.error("❌ Error en POST /api/registrar:", err.message);
    res.status(400).json({ mensaje: err.message });
  }
});

// Página base
app.get("/", (req, res) => {
  res.send(`
    <h2>Sistema de Registro de Flores</h2>
    <p>Ejemplo:</p>
    <code>/api/registrar?id=1&variedad=Freedom&bloque=6&tallos=20&tamali=Largo&etapa=corte</code>
  `);
});

// Arranque del servidor
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log("🚀 Servidor activo en puerto " + PORT);
});