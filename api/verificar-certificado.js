import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  try {
    const numero = req.query.numero;

    if (!numero) {
      return res.status(400).send("Falta parámetro: numero");
    }

    // Buscar el certificado en Supabase
    const { data, error } = await supabase
      .from("certificados")
      .select("*")
      .eq("numero", numero)
      .maybeSingle();

    if (error || !data) {
      return res.status(404).send(`
        <h1>Certificado no encontrado</h1>
        <p>El certificado <strong>${numero}</strong> no existe.</p>
      `);
    }

    const cert = data.datos;
    const inst = cert.instrumento;

    // Respuesta HTML completa
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(`
      <html>
      <head>
        <title>Verificación ${numero}</title>
        <style>
          body { font-family: sans-serif; padding: 30px; max-width: 700px; }
          h1 { color: #0077ff; }
          .btn { 
            background: #28a745; 
            color: white; padding: 10px 20px;
            text-decoration: none; border-radius: 6px; 
          }
        </style>
      </head>
      <body>
        <h1>Certificado ${numero}</h1>

        <h3>Estado: ${data.decision_global}</h3>

        <h2>Instrumento</h2>
        <p><strong>Código:</strong> ${inst.codigo}</p>
        <p><strong>Descripción:</strong> ${inst.descripcion}</p>
        <p><strong>Rango:</strong> ${inst.rango}</p>
        <p><strong>Fecha calibración:</strong> ${cert.condiciones.fecha_calibracion}</p>

        <br>
        <a href="${data.certificado_pdf_url}" class="btn" target="_blank">
          Descargar certificado PDF
        </a>

        <hr>
        <p>TMP · Sistema de Trazabilidad ISO/IEC 17025 — Verificación oficial</p>
      </body>
      </html>
    `);

  } catch (e) {
    console.error(e);

    res.status(500).send("Error interno en la verificación");
  }
}
