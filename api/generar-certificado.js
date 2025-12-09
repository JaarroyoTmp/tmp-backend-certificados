// api/generar-certificado-oficial.js

// Este endpoint:
// 1) Recibe los datos de la calibración en JSON.
// 2) Construye el HTML del certificado.
// 3) Llama a https://api.html2pdf.app/v1/generate con tu API KEY.
// 4) Devuelve el PDF al navegador.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res
      .status(405)
      .json({ error: "Method not allowed. Use POST with JSON body." });
  }

  try {
    const data = req.body || {};

    // Número de certificado para nombre del archivo y QR
    const numeroCert =
      (data.certificado && data.certificado.numero) || "CC-SIN-NUMERO";

    // Construimos el HTML del certificado
    const html = buildCertificateHtml(data);

    // Llamada a HTML2PDF.app
    const apiKey = process.env.HTML2PDF_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        error: "Falta la variable de entorno HTML2PDF_API_KEY en Vercel.",
      });
    }

    const pdfResponse = await fetch("https://api.html2pdf.app/v1/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ html, apiKey }),
    });

    if (!pdfResponse.ok) {
      const text = await pdfResponse.text();
      console.error("HTML2PDF error:", text);
      return res.status(500).json({
        error: "Error al convertir HTML a PDF",
        details: text,
      });
    }

    const arrayBuf = await pdfResponse.arrayBuffer();
    const pdfBuffer = Buffer.from(arrayBuf);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${numeroCert}.pdf"`
    );
    res.send(pdfBuffer);
  } catch (error) {
    console.error("Error en /api/generar-certificado-oficial:", error);
    return res.status(500).json({
      error: "Error generating PDF",
      details: error.toString(),
    });
  }
}

/* ===========================
   Construcción del HTML
   =========================== */

function buildCertificateHtml(data) {
  const cert = data.certificado || {};
  const ins = data.instrumento || {};
  const cond = data.condiciones || {};
  const resumen = data.resumenGlobal || {};
  const bloques = data.bloquesResultados || [];
  const traz = data.trazabilidad || {};
  const firma = data.firma || {};

  // Logo: usa una URL que ya tengas en tu proyecto
  // o define TMP_LOGO_URL en variables de entorno de Vercel
  const logoUrl =
    process.env.TMP_LOGO_URL ||
    "https://tmp-backend-certificados.vercel.app/logo-tmp.png";

  // Datos corporativos que me has pasado
  const companyLine1 = "Talleres Mecánicos Paramio S.L.";
  const companyLine2 = "C/ Real, 123 · 28981 Parla (Madrid) · SPAIN";
  const companyLine3 = "Irayo@tmparamio.com";

  // URL de verificación (para el QR)
  const verificacionUrl = `https://tmp-backend-certificados.vercel.app/certificado?numero=${encodeURIComponent(
    cert.numero || ""
  )}`;

  // QR sencillo usando un servicio público
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=130x130&data=${encodeURIComponent(
    verificacionUrl
  )}`;

  // Tabla de resultados por bloque / punto
  const tablaResultadosHtml = buildResultadosTableHtml(bloques);

  return `
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Certificado de Calibración ${escapeHtml(
    cert.numero || ""
  )}</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 11pt;
    color: #222;
    margin: 0;
    padding: 0;
    background: #fff;
  }
  .page {
    width: 210mm;
    min-height: 297mm;
    padding: 18mm 18mm 20mm 18mm;
    margin: 0 auto;
  }
  header {
    display: flex;
    border-bottom: 2px solid #004b80;
    padding-bottom: 8px;
    margin-bottom: 12px;
    align-items: center;
  }
  header img.logo {
    height: 38px;
    margin-right: 14px;
  }
  header .head-text {
    flex: 1;
  }
  header .head-text h1 {
    margin: 0;
    font-size: 16pt;
    color: #004b80;
  }
  header .head-text p {
    margin: 2px 0;
    font-size: 8.5pt;
    color: #555;
  }
  .cert-meta {
    border: 1px solid #004b80;
    border-radius: 4px;
    padding: 6px 8px;
    font-size: 9pt;
    line-height: 1.3;
    margin-left: 10mm;
  }
  .cert-meta b { color: #004b80; }

  h2.section-title {
    font-size: 12pt;
    margin: 10px 0 4px;
    color: #004b80;
  }
  h3.sub-title {
    font-size: 11pt;
    margin: 6px 0 4px;
    color: #004b80;
  }
  .block {
    border: 1px solid #d0d7e3;
    border-radius: 4px;
    padding: 6px 8px;
    margin-bottom: 8px;
    background: #f9fbff;
  }
  .two-cols {
    display: flex;
    gap: 8mm;
  }
  .col {
    flex: 1;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 8.5pt;
  }
  th, td {
    border: 1px solid #c3c9d5;
    padding: 4px 3px;
    text-align: center;
  }
  th {
    background: #e4ecf7;
    color: #00355f;
  }
  tr:nth-child(even) td {
    background: #f4f7fc;
  }
  .pill {
    display: inline-block;
    padding: 2px 6px;
    border-radius: 999px;
    font-size: 8pt;
    font-weight: bold;
  }
  .pill-ok {
    background: #e2f5ea;
    color: #0e5c33;
    border: 1px solid #2e8b57;
  }
  .pill-bad {
    background: #fde5e5;
    color: #9b1c1c;
    border: 1px solid #d9534f;
  }
  .pill-ind {
    background: #fff6dd;
    color: #8a6d1a;
    border: 1px solid #f0ad4e;
  }
  .summary-box {
    border: 1px solid #d0d7e3;
    border-radius: 4px;
    padding: 5px 7px;
    font-size: 9pt;
    background: #fdfdfd;
  }
  .summary-box b { color: #004b80; }

  .footer {
    display: flex;
    margin-top: 12px;
    font-size: 8.5pt;
  }
  .firma {
    flex: 2;
  }
  .firma-box {
    border-top: 1px solid #777;
    margin-top: 24mm;
    padding-top: 2mm;
  }
  .qr {
    flex: 1;
    text-align: center;
  }
  .qr img {
    margin-top: 4px;
  }
  .mini {
    font-size: 8pt;
    color: #555;
  }
</style>
</head>
<body>
<div class="page">

  <!-- CABECERA -->
  <header>
    <img src="${logoUrl}" alt="TMP" class="logo" />
    <div class="head-text">
      <h1>Certificado de Calibración</h1>
      <p>${companyLine1}</p>
      <p>${companyLine2}</p>
      <p>${companyLine3}</p>
    </div>
    <div class="cert-meta">
      <div><b>Nº Certificado:</b> ${escapeHtml(cert.numero || "")}</div>
      <div><b>Fecha emisión:</b> ${escapeHtml(
        cert.fecha_emision || cond.fecha_calibracion || ""
      )}</div>
      <div><b>Regla de decisión:</b> ${escapeHtml(
        cert.regla_decision || "ILAC-G8"
      )}</div>
    </div>
  </header>

  <!-- 1. FICHA DEL INSTRUMENTO -->
  <h2 class="section-title">1. Datos del instrumento</h2>
  <div class="block">
    <div class="two-cols">
      <div class="col">
        <p><b>Código:</b> ${escapeHtml(ins.codigo || "")}</p>
        <p><b>Descripción:</b> ${escapeHtml(ins.descripcion || "")}</p>
        <p><b>Fabricante / Tipo:</b> ${escapeHtml(
          ins.fabricante_tipo || ""
        )}</p>
        <p><b>Nº de serie:</b> ${escapeHtml(ins.numero_serie || "—")}</p>
      </div>
      <div class="col">
        <p><b>Rango de medida:</b> ${escapeHtml(ins.rango || "—")}</p>
        <p><b>Unidad base:</b> ${escapeHtml(ins.unidad_base || "mm")}</p>
        <p><b>Última calibración:</b> ${escapeHtml(
          ins.fecha_calibracion_anterior || ins.fecha_ultima_cal || "—"
        )}</p>
        <p><b>Próxima calibración:</b> ${escapeHtml(
          ins.fecha_proxima_calibracion || "—"
        )}</p>
      </div>
    </div>
  </div>

  <!-- 2. CONDICIONES AMBIENTALES -->
  <h2 class="section-title">2. Condiciones ambientales</h2>
  <div class="block">
    <div class="two-cols">
      <div class="col">
        <p><b>Temperatura:</b> ${escapeHtml(
          cond.temperatura || ""
        )} °C</p>
        <p><b>Humedad relativa:</b> ${escapeHtml(
          cond.humedad || ""
        )} %</p>
        <p><b>Fecha calibración:</b> ${escapeHtml(
          cond.fecha_calibracion || ""
        )}</p>
      </div>
      <div class="col">
        <p><b>Observaciones ambientales:</b></p>
        <p class="mini">${escapeHtml(cond.observaciones || "—")}</p>
      </div>
    </div>
  </div>

  <!-- 3. MÉTODO Y CRITERIO -->
  <h2 class="section-title">3. Método de calibración y criterio de aceptación</h2>
  <div class="block">
    <p class="mini">
      La calibración se realiza comparando las indicaciones del instrumento con los valores
      nominales de un patrón materializado trazable. Para cada punto se calcula el error
      <b>E = I − R</b>, donde I es la media de las indicaciones y R la referencia
      (patrón o nominal del instrumento).<br/>
      La incertidumbre expandida U (k = 2) se obtiene combinando la incertidumbre del patrón
      y las contribuciones del proceso de medida, con un nivel de confianza aproximado del 95 %. 
      El criterio de aceptación aplicado es el recomendado en la guía <b>ILAC-G8</b>:
      <br/>|E| + U ≤ T → APTO · |E| − U &gt; T → NO APTO · resto → INDETERMINADO.
    </p>
  </div>

  <!-- 4. RESULTADOS DETALLADOS -->
  <h2 class="section-title">4. Resultados detallados</h2>
  ${tablaResultadosHtml}

  <!-- 5. RESUMEN GLOBAL -->
  <h2 class="section-title">5. Resumen global de la calibración</h2>
  <div class="block summary-box">
    <p>
      <b>Nº de bloques:</b> ${resumen.num_bloques || bloques.length || 0} ·
      <b>Nº total de puntos:</b> ${resumen.num_puntos || 0}<br/>
      <b>Máx |E| (µm):</b> ${formatNum(resumen.max_abs_error_um)} ·
      <b>Máx (|E| + U) (µm):</b> ${formatNum(
        resumen.max_abs_error_plus_u_um
      )} ·
      <b>Tolerancia global (µm):</b> ${formatNum(resumen.tolerancia_global_um)}
      <br/>
      <b>Decisión global (ILAC-G8):</b>
      ${buildDecisionPill(resumen.decision_global || "APTO")}
    </p>
  </div>

  <!-- 6. TRAZABILIDAD -->
  <h2 class="section-title">6. Trazabilidad metrológica</h2>
  <div class="block">
    <p class="mini">
      La trazabilidad metrológica se garantiza mediante el uso de patrones materializados cuyo
      estado de calibración se controla en el sistema de gestión del laboratorio.
    </p>
    <p class="mini"><b>Patrones empleados:</b> ${escapeHtml(
      traz.patrones || "No informado"
    )}</p>
    <p class="mini">
      Las correcciones e incertidumbres asociadas a los patrones proceden de sus certificados
      de calibración emitidos por laboratorios acreditados o por interpolación según los
      procedimientos internos de TMP.
    </p>
  </div>

  <!-- 7. VALIDACIÓN DEL INFORME Y QR -->
  <h2 class="section-title">7. Validación del certificado</h2>
  <div class="footer">
    <div class="firma">
      <div class="firma-box">
        <div><b>Operario responsable:</b> ${escapeHtml(
          firma.nombre || ""
        )}</div>
        <div><b>Fecha próxima calibración:</b> ${escapeHtml(
          firma.fecha_proxima || ""
        )}</div>
        <div class="mini" style="margin-top:6px;">
          La firma manuscrita se conserva en el soporte digital interno junto con el presente certificado.
        </div>
      </div>
    </div>
    <div class="qr">
      <div class="mini"><b>Verificación mediante código QR</b></div>
      <img src="${qrUrl}" alt="QR certificado" width="120" height="120" />
      <div class="mini">
        Al escanear el código se accede a la página de verificación del certificado:
        <br/><span>${verificacionUrl}</span>
      </div>
    </div>
  </div>

</div>
</body>
</html>
`;
}

function buildResultadosTableHtml(bloques) {
  if (!Array.isArray(bloques) || !bloques.length) {
    return `
      <div class="block">
        <p class="mini">No se han proporcionado resultados de puntos de calibración.</p>
      </div>`;
  }

  return bloques
    .map((b, i) => {
      const puntos = Array.isArray(b.puntos) ? b.puntos : [];
      const filas = puntos
        .map((p, idx) => {
          return `
          <tr>
            <td>${idx + 1}</td>
            <td>${formatNum(p.nominal_mm, 3)}</td>
            <td>${formatNum(p.correccion_um, 1)}</td>
            <td>${formatNum(p.media_mm, 3)}</td>
            <td>${formatNum(p.error_um, 1)}</td>
            <td>${formatNum(p.u_um, 1)}</td>
            <td>${formatNum(p.tolerancia_um, 1)}</td>
            <td>${buildDecisionPill(p.decision)}</td>
          </tr>`;
        })
        .join("");

      return `
      <div class="block">
        <h3 class="sub-title">
          Bloque ${i + 1}: ${escapeHtml(b.tipo || "")} · ${
        b.nombre_patron ? escapeHtml(b.nombre_patron) : ""
      } · Lado ${escapeHtml(b.lado || "GO")}
        </h3>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Nominal patrón (mm)</th>
              <th>Corrección (µm)</th>
              <th>Media (mm)</th>
              <th>Error (µm)</th>
              <th>U(k=2) (µm)</th>
              <th>Tolerancia (µm)</th>
              <th>Decisión</th>
            </tr>
          </thead>
          <tbody>
            ${filas}
          </tbody>
        </table>
      </div>`;
    })
    .join("");
}

/* ========= Utilidades simples ========= */

function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatNum(v, dec = 1) {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(dec);
}

function buildDecisionPill(dec) {
  const d = (dec || "").toUpperCase();
  const text = d || "APTO";
  if (d === "NO APTO") {
    return `<span class="pill pill-bad">NO APTO</span>`;
  }
  if (d === "INDETERMINADO") {
    return `<span class="pill pill-ind">INDETERMINADO</span>`;
  }
  return `<span class="pill pill-ok">APTO</span>`;
}
