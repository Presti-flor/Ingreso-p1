const express = require("express");
const { writeToSheet, existsSameRecord, refreshCache } = require("./google-sheets");
const { Pool } = require("pg");

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 🔌 Conexión a PostgreSQL (Railway)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // En Railway pones esta variable
  ssl: {
    rejectUnauthorized: false,
  },
});

// 👉 Guarda en Postgres (bloque como numérico/decimal, respeta el punto)
async function saveToPostgres({ id, variedad, bloque, tallos, tamano, fecha, etapa }) {
  // Convertimos el bloque a número (acepta 1, 1.1, 3.5, etc.)
  const bloqueNum = Number(bloque);
  if (Number.isNaN(bloqueNum)) {
    throw new Error("El parámetro bloque debe ser numérico (puede tener decimales, ej: 1.1).");
  }

  const query = `
    INSERT INTO registrosp1
      (id, variedad, bloque, tallos, tamano, fecha, etapa)
    VALUES
      ($1,   $2,      $3,    $4,    $5,    $6,    $7)
    ON CONFLICT DO NOTHING
    RETURNING *;
  `;

  const values = [id, variedad, bloqueNum, tallos, tamano, fecha, etapa || null];

  console.log("🧪 INSERT Postgres →", query);
  console.log("🧪 VALUES →", values);

  const result = await pool.query(query, values);
  return result.rows[0] || null;
}

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

// 👉 Lógica principal AHORA también con PostgreSQL
async function processAndSaveData({
  id,
  variedad,
  bloque,
  tallos,
  tamano,
  fecha,
  etapa,
  force,
}) {
  if (!id) throw new Error("Falta el parámetro id");
  if (!variedad || !bloque || !tallos || !tamano) {
    throw new Error("Faltan datos obligatorios: variedad, bloque, tallos, tamano");
  }

  const tallosNum = parseInt(tallos, 10);
  if (isNaN(tallosNum)) throw new Error("El parámetro tallos debe ser numérico");

  // 👉 bloque puede venir como "1", "1.1", "3.5", etc.
  const bloqueStr = String(bloque).trim();
  if (!bloqueStr) throw new Error("El parámetro bloque es inválido");

  const fechaProcesada = fecha || new Date().toISOString().slice(0, 10);

  if (!force) {
    const yaExiste = await existsSameRecord({
      id,
      variedad,
      bloque: bloqueStr,   // 👈 importante: lo mandamos tal cual (con punto si lo tiene)
      tallos: tallosNum,
      tamano,
      fecha: fechaProcesada,
      etapa,
    });

    if (yaExiste) {
      const err = new Error("Este código ya fue registrado antes.");
      err.code = "DUPLICATE";
      throw err;
    }
  }

  // 🟢 Guardar primero en PostgreSQL
  await saveToPostgres({
    id,
    variedad,
    bloque: bloqueStr,  // saveToPostgres se encarga de convertir a Number
    tallos: tallosNum,
    tamano,
    fecha: fechaProcesada,
    etapa,
  });

  // 🟢 Luego seguir guardando en Google Sheets (como respaldo)
  await writeToSheet({
    id,
    variedad,
    bloque: bloqueStr,  // aquí es texto, para que en Sheets se vea "1.1" tal cual
    tallos: tallosNum,
    tamano,
    fecha: fechaProcesada,
    etapa,
  });

  console.log("✅ Registrado correctamente en Postgres + Sheets:", {
    id,
    variedad,
    bloque: bloqueStr,
    tallos: tallosNum,
    tamano,
    fecha: fechaProcesada,
    etapa,
  });
}

// 👉 Plantilla base ligera (rápida, sin recursos externos)
function baseTemplate({ title, subtitle, bodyHtml, bgColor = "#0f172a", textColor = "#0f172a" }) {

  return `
  <!DOCTYPE html>
  <html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        background: ${bgColor};
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: ${textColor};
        padding: 16px;
      }
      .card {
        max-width: 640px;
        width: 100%;
        background: #ffffff;
        border-radius: 24px;
        box-shadow: 0 18px 45px rgba(15, 23, 42, 0.25);
        padding: 32px 28px;
        text-align: center;
      }
      .title {
        font-size: 2.2rem;
        font-weight: 800;
        margin-bottom: 8px;
      }
      .subtitle {
        font-size: 1rem;
        margin-bottom: 20px;
        opacity: 0.85;
      }
      .body {
        font-size: 1.05rem;
        line-height: 1.5;
      }
      .highlight {
        font-weight: 700;
      }
      .big-emoji {
        font-size: 3.2rem;
        margin-bottom: 10px;
      }
      .btn {
        display: inline-block;
        margin-top: 24px;
        padding: 14px 32px;
        border-radius: 999px;
        border: none;
        font-size: 1.1rem;
        font-weight: 600;
        cursor: pointer;
        text-decoration: none;
        transition: transform 0.08s ease, box-shadow 0.08s ease, background 0.1s ease;
      }
      .btn:active {
        transform: scale(0.97);
        box-shadow: none;
      }
      .btn-primary {
        background: #16a34a;
        color: #f9fafb;
        box-shadow: 0 10px 25px rgba(34, 197, 94, 0.45);
      }
      .btn-primary:hover {
        background: #15803d;
      }
      .btn-outline {
        background: transparent;
        color: inherit;
        border: 2px solid rgba(15, 23, 42, 0.2);
      }
      .chip {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        font-size: 0.95rem;
        padding: 6px 14px;
        border-radius: 999px;
        background: rgba(148, 163, 184, 0.12);
        margin-bottom: 18px;
      }
      .chip-dot {
        width: 8px;
        height: 8px;
        border-radius: 999px;
        background: #22c55e;
      }
      .small {
        font-size: 0.85rem;
        margin-top: 16px;
        opacity: 0.8;
      }
    </style>
  </head>
  <body>
    <main class="card">
      ${subtitle ? `<div class="chip"><span class="chip-dot"></span>${subtitle}</div>` : ""}
      <div class="big-emoji">🌹</div>
      <h1 class="title">${title}</h1>
      <div class="body">
        ${bodyHtml}
      </div>
    </main>
  </body>
  </html>
  `;
}

// GET (para el QR)
app.get("/api/registrar", async (req, res) => {
  try {
    if (!validateIP(req)) {
      return res
        .status(403)
        .send(
          baseTemplate({
            title: "Acceso no autorizado",
            subtitle: "IP no autorizada",
            bgColor: "#fee2e2",
            textColor: "#7f1d1d",
            bodyHtml: `
              <p>La IP desde la que se está escaneando no está autorizada para registrar datos.</p>
              <p class="small">Si crees que esto es un error, contacta con el administrador del sistema.</p>
            `,
          })
        );
    }

    // Aquí aceptamos tanto tamali (QR viejo) como tamano (si algún día lo cambias)
    const { id, variedad, bloque, tallos, tamali, tamano, fecha, etapa, force } = req.query;
    const tamanoFinal = tamano || tamali;

    const forceFlag = force === "true" || force === "1";

    if (!id || !variedad || !bloque || !tallos || !tamanoFinal) {
      return res
        .status(400)
        .send(
          baseTemplate({
            title: "Faltan datos",
            subtitle: "Registro incompleto",
            bgColor: "#fef9c3",
            textColor: "#78350f",
            bodyHtml: `
              <p>El código escaneado no trae toda la información necesaria.</p>
              <p style="margin-top:8px;">Verifica que el QR tenga: <span class="highlight">id, variedad, bloque, tallos y tamano</span>.</p>
              <p class="small">Puedes escanear nuevamente el código o pedir que generen uno actualizado.</p>
            `,
          })
        );
    }

    await processAndSaveData({
      id,
      variedad,
      bloque,              // 👈 aquí puede venir "1.1" sin problema
      tallos,
      tamano: tamanoFinal,
      fecha,
      etapa,
      force: forceFlag,
    });

    // ✅ REGISTRO EXITOSO
    return res.send(
      baseTemplate({
        title: "Registro guardado correctamente",
        bgColor: "#ecfdf3",          // Verde muy suave
        textColor: "#064e3b",        // Verde oscuro para buena lectura
        bodyHtml: `
          <p style="text-align:center;font-size:3rem;margin-bottom:8px;">✅</p>

          <p style="margin-bottom:10px; font-size:1.1rem; color:#064e3b;">
            Variedad: <span class="highlight">${variedad}</span><br/>
            Bloque: <span class="highlight">${bloque}</span><br/>
            Tallos: <span class="highlight">${tallos}</span><br/>
            Tamano: <span class="highlight">${tamanoFinal}</span>
          </p>
        `,
      })
    );
  } catch (err) {
    console.error("❌ Error en /api/registrar:", err);

    const esDoble =
      err.code === "DUPLICATE" ||
      (typeof err.message === "string" &&
        err.message.toLowerCase().includes("ya fue registrado"));

    if (esDoble) {
      const currentUrl = req.originalUrl;
      const separator = currentUrl.includes("?") ? "&" : "?";
      const newUrl = `${currentUrl}${separator}force=true`;

      // ⚠️ CÓDIGO YA REGISTRADO (fondo naranja, texto legible)
      return res.status(400).send(`
        <!DOCTYPE html>
        <html lang="es">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>Código ya registrado</title>
          <style>
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body {
              min-height: 100vh;
              display: flex;
              align-items: center;
              justify-content: center;
              background: #ffedd5; /* naranja suave */
              font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
              color: #111827;
              padding: 16px;
            }
            .card {
              max-width: 680px;
              width: 100%;
              background: #ffffff;
              border-radius: 24px;
              box-shadow: 0 18px 45px rgba(15, 23, 42, 0.28);
              padding: 32px 28px;
              text-align: center;
            }
            .chip {
              display: inline-flex;
              align-items: center;
              gap: 8px;
              font-size: 0.95rem;
              padding: 6px 14px;
              border-radius: 999px;
              background: rgba(248, 113, 113, 0.1);
              color: #7f1d1d;
              margin-bottom: 14px;
            }
            .chip-dot {
              width: 8px;
              height: 8px;
              border-radius: 999px;
              background: #f97316;
            }
            .big-emoji {
              font-size: 3.2rem;
              margin-bottom: 10px;
            }
            .title {
              font-size: 2.2rem;
              font-weight: 800;
              margin-bottom: 8px;
              color: #7c2d12;
            }
            .body {
              font-size: 1.05rem;
              line-height: 1.5;
              margin-top: 8px;
            }
            .highlight {
              font-weight: 700;
            }
            .btn {
              display: inline-block;
              margin-top: 24px;
              padding: 16px 40px;
              border-radius: 999px;
              border: none;
              font-size: 1.15rem;
              font-weight: 700;
              cursor: pointer;
              text-decoration: none;
              transition: transform 0.08s ease, box-shadow 0.08s ease, background 0.1s ease;
              box-shadow: 0 12px 28px rgba(22, 163, 74, 0.45);
            }
            .btn:active {
              transform: scale(0.97);
              box-shadow: none;
            }
            .btn-confirm {
              background: #22c55e;
              color: #032013;
            }
            .btn-confirm:hover {
              background: #16a34a;
            }
            .small {
              font-size: 0.85rem;
              margin-top: 16px;
              color: #4b5563;
            }
          </style>
        </head>
        <body>
          <main class="card">
            <div class="chip">
              <span class="chip-dot"></span>
              Posible doble registro
            </div>
            <div class="big-emoji">⚠️</div>
            <h1 class="title">Este código ya fue escaneado</h1>
            <div class="body">
              
              <p style="margin-top:10px;">
                Solo continúa si estás <span class="highlight">seguro</span>
                de que quieres registrar nuevamente.
              </p>
              <button
                onclick="window.location.href='${newUrl}'"
                class="btn btn-confirm"
              >
                Registrar de todas formas
              </button>
             
            </div>
          </main>
        </body>
        </html>
      `);
    }

    // ❌ ERROR GENERAL
    return res.status(400).send(
      baseTemplate({
        title: "Error en el registro",
        subtitle: "❌ No se pudo guardar",
        bgColor: "#111827",
        textColor: "#f9fafb",
        bodyHtml: `
          <p style="font-size:1.05rem; margin-bottom:10px;">
            Ocurrió un problema al procesar el registro.
          </p>
          <p style="margin-bottom:10px;">
            Detalle: <span class="highlight">${err.message}</span>
          </p>
          <p class="small">
            Puedes intentar escanear nuevamente el código. Si el error se repite,
            informa al responsable del sistema para revisión.
          </p>
        `,
      })
    );
  }
});

// Página base
app.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Sistema de Registro de Flores</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: radial-gradient(circle at top, #38bdf8 0, #0f172a 55%);
          font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          color: #0f172a;
          padding: 16px;
        }
        .card {
          max-width: 720px;
          width: 100%;
          background: #f9fafb;
          border-radius: 24px;
          box-shadow: 0 18px 45px rgba(15, 23, 42, 0.4);
          padding: 32px 28px;
        }
        h1 {
          font-size: 2rem;
          margin-bottom: 8px;
          font-weight: 800;
        }
        p {
          margin-bottom: 10px;
          font-size: 1rem;
        }
        code {
          display: inline-block;
          margin-top: 8px;
          background: #020617;
          color: #e5e7eb;
          padding: 10px 14px;
          border-radius: 10px;
          font-size: 0.95rem;
          word-break: break-all;
        }
        .tag {
          display: inline-block;
          font-size: 0.85rem;
          padding: 4px 10px;
          border-radius: 999px;
          background: #e0f2fe;
          color: #075985;
          margin-bottom: 8px;
        }
      </style>
    </head>
    <body>
      <main class="card">
        <div class="tag">Panel técnico</div>
        <h1> Sistema de Registro de Flores 🌹</h1>
        <p>Endpoint disponible para lectura de códigos QR y registro en Google Sheets + PostgreSQL.</p>
        <p>Ejemplo de uso:</p>
        <code>
          /api/registrar?id=1&variedad=Freedom&bloque=6&tallos=20&tamano=Largo
        </code>
        <p style="margin-top:12px;font-size:0.9rem;opacity:0.8%;">
          El procesamiento es ligero y está optimizado para respuestas rápidas en campo.
        </p>
      </main>
    </body>
    </html>
  `);
});

app.get("/admin/refresh-cache", async (req, res) => {
  try {
    const token = req.query.token || req.headers["x-admin-token"];
    if (token !== process.env.ADMIN_REFRESH_TOKEN) {
      return res.status(403).json({ error: "No autorizado" });
    }

    const info = await refreshCache();
    res.json({
      message: "Caché recargada correctamente desde Google Sheets",
      info,
    });
  } catch (err) {
    console.error("Error en /admin/refresh-cache:", err);
    res.status(500).json({
      error: "Error al recargar caché",
      detail: err.message,
    });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log("🚀 Servidor activo en puerto " + PORT);
});