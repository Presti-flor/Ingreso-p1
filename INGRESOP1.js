const express = require("express");
const { writeToSheet, existsSameRecord } = require("./google-sheets");

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Lista de IPs autorizadas
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

// Normaliza IP
function validateIP(req) {
  const raw =
    req.headers["x-forwarded-for"] || req.connection.remoteAddress || "";
  const clientIP = raw.split(",")[0].trim();
  console.log("📡 IP del cliente:", clientIP);
  return authorizedIPs.includes(clientIP);
}

// 👉 Lógica principal sin PostgreSQL
async function processAndSaveData({
  id,
  variedad,
  bloque,
  tallos,
  tamali,
  fecha,
  etapa,
  force,
}) {
  if (!id) throw new Error("Falta el parámetro id");
  if (!variedad || !bloque || !tallos || !tamali) {
    throw new Error("Faltan datos obligatorios: variedad, bloque, tallos, tamali");
  }

  const tallosNum = parseInt(tallos);
  if (isNaN(tallosNum)) throw new Error("El parámetro tallos debe ser numérico");

  const fechaProcesada = fecha || new Date().toISOString().slice(0, 10);

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
      const err = new Error("Este código ya fue registrado antes.");
      err.code = "DUPLICATE";
      throw err;
    }
  }

  // Guardar solo en Google Sheets
  await writeToSheet({
    id,
    variedad,
    bloque,
    tallos: tallosNum,
    tamali,
    fecha: fechaProcesada,
    etapa,
  });

  console.log("✅ Registrado correctamente en Sheets:", {
    id,
    variedad,
    bloque,
    tallos: tallosNum,
    tamali,
    fecha: fechaProcesada,
    etapa,
  });
}

// GET (para el QR)
app.get("/api/registrar", async (req, res) => {
  try {
    if (!validateIP(req)) {
      return res.status(403).send(`
        <html><body style="text-align:center;margin-top:60px;font-family:sans-serif;">
        <h1 style="color:#dc2626;font-size:60px;">🚫 IP no autorizada</h1>
        </body></html>
      `);
    }

    const { id, variedad, bloque, tallos, tamali, fecha, etapa, force } = req.query;
    const forceFlag = force === "true" || force === "1";

    if (!id || !variedad || !bloque || !tallos || !tamali) {
      return res.status(400).send(`
        <html><body style="text-align:center;margin-top:60px;">
        <h1 style="color:#dc2626;font-size:60px;">⚠️ Faltan parámetros</h1>
        </body></html>
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

    res.send(`
      <html><body style="font-family:sans-serif;text-align:center;margin-top:160px;">
        <h1 style="font-size:100px;color:#22c55e;">✅ REGISTRO GUARDADO</h1>
        <p style="font-size:32px;">
          Variedad: <b>${variedad}</b> | Bloque: <b>${bloque}</b> | Tallos: <b>${tallos}</b>
        </p>
      </body></html>
    `);
  } catch (err) {
    console.error("❌ Error en /api/registrar:", err);

    const esDoble =
      err.code === "DUPLICATE" ||
      err.message.includes("ya fue registrado");

    if (esDoble) {
      const currentUrl = req.originalUrl;
      const separator = currentUrl.includes("?") ? "&" : "?";
      const newUrl = `${currentUrl}${separator}force=true`;

      return res.status(400).send(`
        <html><body style="text-align:center;margin-top:120px;background:#b9deff;">
          <h1 style="font-size:72px;color:#f41606;">⚠️ CÓDIGO YA REGISTRADO</h1>
          <button onclick="window.location.href='${newUrl}'"
            style="padding:20px 80px;font-size:55px;background:#22c55e;color:white;border:none;border-radius:31px;">
            Registrar de todas formas
          </button>
        </body></html>
      `);
    }

    res.status(400).send(`
      <html><body style="text-align:center;margin-top:160px;background:#111827;color:white;">
        <h1 style="font-size:72px;color:#dc2626;">❌ ERROR EN EL REGISTRO</h1>
        <p style="font-size:30px;">${err.message}</p>
      </body></html>
    `);
  }
});

// Página base
app.get("/", (req, res) => {
  res.send(`
    <h2>Sistema de Registro de Flores</h2>
    <p>Ejemplo:</p>
    <code>/api/registrar?id=1&variedad=Freedom&bloque=6&tallos=20&tamali=Largo</code>
  `);
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log("🚀 Servidor activo en puerto " + PORT);
});