// api/generar-certificado-oficial.js

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res
      .status(405)
      .json({ error: "Method not allowed. Use POST with JSON body." });
  }

  try {
    const data = req.body || {};

    const cert = data.certificado || {};
    const numeroCert = cert.numero || "CC-SIN-NUMERO";

    const html = buildCertificateHtml(data);

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

/* ============ HTML DEL CERTIFICADO (VERSIÓN DEMO PARA PROBAR) ============ */

function buildCertificateHtml(data) {
  const cert = data.certificado || {};
  const ins = data.instrumento || {};
  const cond = data.condiciones || {};
  const resumen = data.resumenGlobal || {};
  const bloques = data.bloquesResultados || [];

  const logoUrl =
    process.env.TMP_LOGO_URL ||
    "https://tmp-backend-certificados.vercel.app/logo-tmp.png";

  const companyLine1 = "Talleres Mecánicos Paramio S.L.";
  const companyLine2 = "C/ Real, 123 · 28981 Parla (Madrid) · SPAIN";
  const companyLine3 = "Irayo@tmparamio.com";

  const verificacionUrl = `https://tmp-backend-certificados.vercel.app/certificado?numero=${encodeURIComponent(
    cert.numero || ""
  )}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=130x130&data=${encodeURIComponent(
    verificacionUrl
  )}`;

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

  <h2 class="section-title">Certificado DEMO</h2>
  <div class="block">
    <p>Esta es una versión de prueba del certificado, generada desde
    <b>/api/generar-certificado-oficial</b> usando HTML2PDF.app.</p>
    <p><b>Código instrumento:</b> ${escapeHtml(ins.codigo || "DEMO-001")}</p>
    <p><b>Descripción:</b> ${escapeHtml(ins.descripcion || "Instrumento demo")}</p>
  </div>

  ${tablaResultadosHtml}

  <h2 class="section-title">Resumen global (demo)</h2>
  <div class="block summary-box">
    <p>
      <b>Decisión global:</b> ${buildDecisionPill(
        resumen.decision_global || "APTO"
      )}
    </p>
  </div>

  <div class="footer">
    <div class="firma">
      <div class="firma-box">
        <div><b>Operario responsable:</b> DEMO</div>
        <div class="mini">La firma manuscrita se conserva en el archivo interno.</div>
      </div>
    </div>
    <div class="qr">
      <div class="mini"><b>Verificación QR (demo)</b></div>
      <img src="${qrUrl}" alt="QR certificado" width="120" height="120" />
      <div class="mini">
        URL: ${verificacionUrl}
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
        <p class="mini">No se han proporcionado resultados de puntos (demo).</p>
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
          Bloque ${i + 1}: ${escapeHtml(b.tipo || "DEMO")} · ${
        b.nombre_patron ? escapeHtml(b.nombre_patron) : ""
      }
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
  if (d === "NO APTO") {
    return `<span class="pill pill-bad">NO APTO</span>`;
  }
  if (d === "INDETERMINADO") {
    return `<span class="pill pill-ind">INDETERMINADO</span>`;
  }
  return `<span class="pill pill-ok">APTO</span>`;
}
