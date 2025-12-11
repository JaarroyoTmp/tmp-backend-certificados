// ==========================================
// API: generar-certificado-oficial
// ==========================================
import { createClient } from "@supabase/supabase-js";
import PDFDocument from "pdfkit";
import QRCode from "qrcode"; // QR para verificación online

// ==== CONFIG SUPABASE ====
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_KEY; // service role
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE);

// ==========================================
// Utilidad para subir PDF a Supabase Storage
// ==========================================
async function subirPDF(buffer, fileName) {
  const { error: uploadError } = await supabase.storage
    .from("certificados")
    .upload(fileName, buffer, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (uploadError) throw uploadError;

  const { data: publicURL } = supabase.storage
    .from("certificados")
    .getPublicUrl(fileName);

  return publicURL.publicUrl;
}

// ==========================================
// Generar número oficial de certificado
// CC-2025-0001, CC-2025-0002…
// ==========================================
async function generarNumeroCertificado() {
  const year = new Date().getFullYear();

  const { data, error } = await supabase
    .from("certificados")
    .select("numero")
    .like("numero", `CC-${year}-%`);

  if (error) throw error;

  const nums = (data || []).map((r) => {
    const m = r.numero?.match(/CC-\d+-(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  });

  const next = (Math.max(0, ...nums) + 1).toString().padStart(4, "0");

  return `CC-${year}-${next}`;
}

// ==========================================
// Helpers de formato
// ==========================================
const fmt = (v, dec = 3) => {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toFixed(dec);
};

// ==========================================
// Generar PDF oficial de calibración (plantilla profesional)
// ==========================================
async function generarPDF(certJSON, numero) {
  const doc = new PDFDocument({
    size: "A4",
    margin: 40,
    info: {
      Title: `Certificado ${numero}`,
      Author: "TMP Calibration System",
      Subject: "Certificado de calibración",
    },
  });

  const chunks = [];
  doc.on("data", (c) => chunks.push(c));

  const hoyISO = new Date().toISOString().substring(0, 10);
  const urlVerif = certJSON.qr?.url_verificacion || "";

  // Colores corporativos suaves
  const azul = "#005a9c";
  const azulOscuro = "#003d6b";
  const naranja = "#f28c1a";
  const grisSuave = "#f5f7fb";
  const grisTexto = "#444444";

  const paginaAncho = doc.page.width;
  const margenIzq = doc.page.margins.left;
  const margenDer = doc.page.margins.right;
  const anchoContenido = paginaAncho - margenIzq - margenDer;

  // Para tablas centradas (opción B)
  const anchoTabla = 460; // más estrecho que el contenido
  const xTabla = margenIzq + (anchoContenido - anchoTabla) / 2;

  // ================================
  // GENERAR QR (si hay URL)
  // ================================
  let qrBuffer = null;
  if (urlVerif) {
    try {
      qrBuffer = await QRCode.toBuffer(urlVerif, {
        errorCorrectionLevel: "M",
      });
    } catch (e) {
      console.error("Error generando QR:", e);
    }
  }

  // ================================
  // FUNCIONES DE DIBUJO
  // ================================
  function lineaSeparadora() {
    doc
      .moveTo(margenIzq, doc.y)
      .lineTo(paginaAncho - margenDer, doc.y)
      .lineWidth(1)
      .strokeColor(naranja)
      .stroke();
  }

  function seccionTitulo(num, texto) {
    doc.moveDown(0.5);
    const barX = xTabla;
    const barY = doc.y;
    const barH = 14;

    doc
      .roundedRect(barX, barY, anchoTabla, barH, 3)
      .fillColor(azul)
      .fill();

    doc
      .fillColor("#ffffff")
      .fontSize(9)
      .font("Helvetica-Bold")
      .text(`${num}. ${texto}`, barX + 6, barY + 3);

    doc.moveDown(1.5);
    doc.fillColor(grisTexto).font("Helvetica");
  }

  function checkSaltoPagina(alturaNecesaria = 60) {
    const bottom = doc.page.height - doc.page.margins.bottom;
    if (doc.y + alturaNecesaria > bottom) {
      doc.addPage();
    }
  }

  function dibujarTablaCentrada(headers, rows, colWidths, opciones = {}) {
    const startY = doc.y;
    const rowAltura = opciones.rowHeight || 14;
    const headerAltura = opciones.headerHeight || 16;
    const fuenteSize = opciones.fontSize || 8;

    const x = xTabla;
    const y = startY;

    // Rect fondo tabla
    doc
      .roundedRect(x - 4, y - 4, anchoTabla + 8, headerAltura + 4, 4)
      .fillColor(azul)
      .fill();

    // Encabezados
    doc
      .fillColor("#ffffff")
      .font("Helvetica-Bold")
      .fontSize(fuenteSize);

    let cx = x;
    headers.forEach((h, idx) => {
      const w = colWidths[idx];
      doc.text(String(h), cx + 2, y - 1, {
        width: w - 4,
        align: "center",
      });
      cx += w;
    });

    let currentY = y + headerAltura;

    // Filas
    rows.forEach((row, filaIdx) => {
      checkSaltoPagina(rowAltura + 10);
      if (currentY !== doc.y) currentY = doc.y;

      // Fondo alterno
      const isOdd = filaIdx % 2 === 0;
      doc
        .rect(x - 4, currentY - 2, anchoTabla + 8, rowAltura)
        .fillColor(isOdd ? grisSuave : "#ffffff")
        .fill();

      doc
        .fillColor(grisTexto)
        .font("Helvetica")
        .fontSize(fuenteSize);

      let cxRow = x;
      row.forEach((cell, colIdx) => {
        const w = colWidths[colIdx];
        doc.text(
          cell === undefined || cell === null ? "" : String(cell),
          cxRow + 2,
          currentY,
          {
            width: w - 4,
            align: colIdx === 0 ? "left" : "center",
          }
        );
        cxRow += w;
      });

      currentY += rowAltura;
      doc.y = currentY;
    });

    doc.moveDown(0.5);
  }

  // ================================
  // PORTADA / PÁGINA 1
  // ================================
  // Cabecera
  doc.fillColor(azulOscuro).font("Helvetica-Bold").fontSize(16);
  doc.text("CERTIFICADO DE CALIBRACIÓN", {
    align: "center",
  });

  doc.moveDown(0.2);
  doc
    .fontSize(10)
    .font("Helvetica")
    .fillColor(grisTexto)
    .text(`Número: ${numero}`, { align: "center" });
  doc.text(`Fecha de emisión: ${hoyISO}`, { align: "center" });

  // Línea naranja superior
  doc.moveDown(0.3);
  lineaSeparadora();

  // QR arriba derecha
  if (qrBuffer) {
    try {
      const qrSize = 80;
      const qrX = paginaAncho - margenDer - qrSize;
      const qrY = doc.page.margins.top + 10;

      doc.image(qrBuffer, qrX, qrY, { width: qrSize, height: qrSize });
      doc
        .fontSize(7)
        .fillColor(grisTexto)
        .text("Verificación online", qrX, qrY + qrSize + 2, {
          width: qrSize,
          align: "center",
        });
    } catch (e) {
      console.error("No se pudo dibujar el QR en el PDF:", e);
    }
  }

  doc.moveDown(1.5);

  // 1. Datos del instrumento
  seccionTitulo(1, "Datos del instrumento");

  const ins = certJSON.instrumento || {};
  doc
    .fontSize(9)
    .fillColor(grisTexto)
    .font("Helvetica")
    .text(`Código: ${ins.codigo || "-"}`)
    .text(`Descripción: ${ins.descripcion || "-"}`)
    .text(`Fabricante / Tipo: ${ins.fabricante_tipo || "-"}`)
    .text(`Rango: ${ins.rango || "-"}`)
    .text(`Unidad base: ${ins.unidad_base || "-"}`);

  // 2. Condiciones ambientales
  seccionTitulo(2, "Condiciones ambientales durante la calibración");
  const cond = certJSON.condiciones || {};
  doc
    .fontSize(9)
    .text(`Temperatura: ${cond.temperatura ?? "—"} °C`)
    .text(`Humedad relativa: ${cond.humedad ?? "—"} %`)
    .text(`Fecha de calibración: ${cond.fecha_calibracion ?? "—"}`);
  if (cond.observaciones) {
    doc.moveDown(0.3);
    doc.text(`Observaciones: ${cond.observaciones}`);
  }

  // 3. Trazabilidad metrológica y patrones
  seccionTitulo(3, "Trazabilidad metrológica y patrones utilizados");
  doc
    .fontSize(9)
    .text(
      "La trazabilidad metrológica se garantiza mediante el uso de patrones materializados con trazabilidad al SI " +
        "siguiendo buenas prácticas metrológicas y guías ISO/IEC 17025."
    );

  doc.moveDown(0.4).font("Helvetica-Bold").text("Patrones empleados:");
  doc.font("Helvetica");
  (certJSON.patrones || []).forEach((p) => {
    doc
      .fontSize(9)
      .text(
        `• ${p.codigo || "-"} — ${p.descripcion || "-"} ` +
          `(U(k=2): ${p.u_k2 ?? "—"})`
      );
  });

  // 4. Resultados (resumen global)
  seccionTitulo(4, "Resultados de la calibración (resumen)");
  doc
    .fontSize(9)
    .text(
      certJSON.resumen_global ||
        "Se han evaluado los puntos definidos en el plan de calibración."
    );

  // 5. Validación del certificado
  seccionTitulo(5, "Validación del certificado");

  const firma = certJSON.firma || {};
  const yFirmaBox = doc.y;
  const altoBox = 60;
  const anchoBox = anchoTabla;

  // Caja firma centrada
  doc
    .roundedRect(xTabla, yFirmaBox, anchoBox, altoBox, 4)
    .strokeColor("#cccccc")
    .lineWidth(0.7)
    .stroke();

  // Datos firma
  doc
    .fontSize(9)
    .fillColor(grisTexto)
    .font("Helvetica")
    .text(
      `Operario responsable: ${firma.nombre || "—"}`,
      xTabla + 6,
      yFirmaBox + 6
    )
    .text(
      `Próxima calibración: ${firma.proxima_calibracion || "—"}`,
      xTabla + 6,
      yFirmaBox + 20
    );

  // Firma manuscrita dentro de la caja
  if (firma.firma_base64) {
    try {
      const img = firma.firma_base64.replace(/^data:image\/png;base64,/, "");
      const buf = Buffer.from(img, "base64");
      doc.image(buf, xTabla + 6, yFirmaBox + 32, {
        fit: [120, 40],
      });
    } catch (e) {
      doc
        .fontSize(8)
        .fillColor("#aa0000")
        .text("(No se pudo insertar la firma manuscrita)", xTabla + 6, yFirmaBox + 36);
    }
  }

  // Sello redondo a la derecha de la caja de firma
  const selloRadio = 28;
  const selloCentroX = xTabla + anchoBox - selloRadio - 8;
  const selloCentroY = yFirmaBox + altoBox / 2;

  doc
    .circle(selloCentroX, selloCentroY, selloRadio)
    .lineWidth(1.2)
    .strokeColor(naranja)
    .stroke();

  doc
    .fontSize(7)
    .fillColor(azulOscuro)
    .font("Helvetica-Bold")
    .text(
      "LABORATORIO\nTALLERES\nPARAMIO",
      selloCentroX - selloRadio + 4,
      selloCentroY - 14,
      {
        width: selloRadio * 2 - 8,
        align: "center",
      }
    );

  doc.moveDown(3);

  // 6. Verificación del certificado
  seccionTitulo(6, "Verificación del certificado");
  doc
    .fontSize(8)
    .fillColor(grisTexto)
    .text(
      urlVerif
        ? `Este certificado puede verificarse en: ${urlVerif}`
        : "URL de verificación no disponible."
    );

  // Pie legal pequeño
  doc.moveDown(0.8);
  doc
    .fontSize(6.5)
    .fillColor("#777777")
    .text(
      "Este certificado ha sido emitido por el laboratorio interno de Talleres Mecánicos Paramio " +
        "siguiendo los principios ISO/IEC 17025 e ILAC-G8. La reproducción parcial no está permitida sin autorización.",
      {
        align: "justify",
      }
    );

  // ================================
  // PÁGINAS SIGUIENTES: TABLAS DETALLADAS
  // ================================
  const bloques = certJSON.bloques || [];
  if (bloques.length) {
    doc.addPage();

    doc
      .fontSize(12)
      .font("Helvetica-Bold")
      .fillColor(azulOscuro)
      .text("ANEXO METROLÓGICO · RESULTADOS DETALLADOS", {
        align: "center",
      });

    doc.moveDown(0.5);
    lineaSeparadora();
    doc.moveDown(0.8);

    bloques.forEach((b, idxBloque) => {
      checkSaltoPagina(80);

      // Título de bloque
      doc
        .font("Helvetica-Bold")
        .fillColor(azulOscuro)
        .fontSize(10)
        .text(
          `Bloque ${idxBloque + 1} · Tipo: ${b.tipo || "-"} · Patrón ${
            b.patron?.codigo || "-"
          } – ${b.patron?.descripcion || "-"}`,
          {
            align: "left",
          }
        );
      doc.moveDown(0.2);
      doc
        .fontSize(8)
        .font("Helvetica")
        .fillColor(grisTexto)
        .text(`Lado GO/NO GO: ${b.lado || "—"}`);
      doc.moveDown(0.4);

      const puntos = b.puntos || [];

      // =====================
      // TABLA 1: LECTURAS
      // =====================
      const headersLect = [
        "Nominal (mm)",
        "R1",
        "R2",
        "R3",
        "R4",
        "R5",
        "Media",
        "σ",
      ];
      const colLect = [70, 45, 45, 45, 45, 45, 60, 60];

      const rowsLect = puntos.map((p) => {
        const lecturas = p.lecturas || p.lecturas_mm || p.mediciones || [];
        const r1 = lecturas[0] ?? "";
        const r2 = lecturas[1] ?? "";
        const r3 = lecturas[2] ?? "";
        const r4 = lecturas[3] ?? "";
        const r5 = lecturas[4] ?? "";

        return [
          fmt(p.nominal ?? p.valor_nominal ?? p.nominal_mm, 3),
          fmt(r1, 3),
          fmt(r2, 3),
          fmt(r3, 3),
          fmt(r4, 3),
          fmt(r5, 3),
          fmt(p.media, 3),
          fmt(p.sigma ?? p.desviacion ?? p.s, 3),
        ];
      });

      if (rowsLect.length) {
        doc
          .fontSize(9)
          .font("Helvetica-Bold")
          .fillColor(azul)
          .text("Tabla 1 · Lecturas individuales y estadísticos", xTabla, doc.y, {
            width: anchoTabla,
          });
        doc.moveDown(0.2);

        dibujarTablaCentrada(headersLect, rowsLect, colLect, {
          rowHeight: 13,
          headerHeight: 16,
          fontSize: 7.8,
        });
      }

      checkSaltoPagina(80);

      // =====================
      // TABLA 2: RESULTADOS
      // =====================
      const headersRes = [
        "Nominal (mm)",
        "Corr (µm)",
        "Error (µm)",
        "U(k=2) (µm)",
        "Tolerancia (µm)",
        "Decisión",
      ];
      const colRes = [80, 70, 70, 70, 80, 90];

      const rowsRes = puntos.map((p) => {
        const corrUm =
          p.correccion_um ??
          (p.correccion_patron !== undefined
            ? Number(p.correccion_patron) * 1000
            : null);

        return [
          fmt(p.nominal ?? p.valor_nominal ?? p.nominal_mm, 3),
          fmt(corrUm, 1),
          fmt(p.error_um ?? p.error, 1),
          fmt(p.U_um ?? p.U_total_um ?? p.U_total, 1),
          fmt(p.T_um ?? p.tolerancia_um ?? p.tolerancia, 1),
          p.decision || p.resultado || "",
        ];
      });

      if (rowsRes.length) {
        doc
          .fontSize(9)
          .font("Helvetica-Bold")
          .fillColor(azul)
          .text(
            "Tabla 2 · Resultados metrológicos por punto (ILAC-G8)",
            xTabla,
            doc.y,
            { width: anchoTabla }
          );
        doc.moveDown(0.2);

        dibujarTablaCentrada(headersRes, rowsRes, colRes, {
          rowHeight: 13,
          headerHeight: 16,
          fontSize: 7.8,
        });
      }

      doc.moveDown(0.8);

      // Pequeña nota por bloque
      doc
        .fontSize(7)
        .font("Helvetica-Oblique")
        .fillColor("#777777")
        .text(
          "Nota: los errores y la decisión de conformidad se han evaluado según el criterio ILAC-G8 " +
            "considerando la incertidumbre expandida U(k=2) y la tolerancia especificada.",
          xTabla,
          doc.y,
          { width: anchoTabla, align: "justify" }
        );

      doc.moveDown(1.2);
    });
  }

  // FINALIZAR PDF
  doc.end();

  return new Promise((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

// ==========================================
// MAIN HANDLER
// ==========================================
export default async function handler(req, res) {
  // ====== CORS ======
  res.setHeader(
    "Access-Control-Allow-Origin",
    "https://trazabilidad-tmp.vercel.app"
  );
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Método no permitido" });
    }

    const certJSON =
      typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    // 1) Número oficial
    const numero = await generarNumeroCertificado();

    // 2) URL de verificación
    const verificacionURL = `https://tmp-backend-certificados.vercel.app/api/verificar-certificado?numero=${numero}`;
    certJSON.qr = certJSON.qr || {};
    certJSON.qr.url_verificacion = verificacionURL;

    // 3) Generar PDF (con portada + anexos detallados)
    const pdfBuffer = await generarPDF(certJSON, numero);

    // 4) Subir PDF a Storage
    const pdfURL = await subirPDF(pdfBuffer, `${numero}.pdf`);

    // 5) Decisión global desde resumen
    const resumenTxt = certJSON.resumen_global || "";
    let decisionGlobal = "APTO";
    if (resumenTxt.includes("NO APTO")) decisionGlobal = "NO APTO";
    else if (resumenTxt.includes("INDETERMINADO"))
      decisionGlobal = "INDETERMINADO";

    // 6) Registrar en Supabase
    await supabase.from("certificados").insert({
      numero,
      datos: certJSON,
      certificado_pdf_url: pdfURL,
      regla_decision: "ILAC-G8",
      decision_global: decisionGlobal,
    });

    // 7) Respuesta al frontend
    return res.status(200).json({
      ok: true,
      certificado: {
        numero,
        pdf_url: pdfURL,
        verificacion_url: verificacionURL,
      },
    });
  } catch (e) {
    console.error("ERROR API:", e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
