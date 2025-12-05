export default async function handler(req, res) {
  console.log("Usando PDFShift v1 (endpoint cargado correctamente)");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { html, filename } = req.body;

    if (!html) {
      return res.status(400).json({ error: "Missing HTML" });
    }

    const apiKey = process.env.PDFSHIFT_API_KEY;

    if (!apiKey) {
      console.error("PDFSHIFT_API_KEY no está definida en Vercel");
      return res.status(500).json({ error: "Missing PDFShift API key" });
    }

    console.log("Llamando a PDFShift...");

    // Llamada a PDFShift (NO Puppeteer, NO Chromium)
    const pdfRes = await fetch("https://api.pdfshift.io/v3/convert/pdf", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Basic " + Buffer.from(apiKey + ":").toString("base64"),
      },
      body: JSON.stringify({
        source: html,
        use_print: true,
        background: true
      }),
    });

    if (!pdfRes.ok) {
      const errorText = await pdfRes.text();
      console.error("Error de PDFShift:", errorText);
      return res.status(500).json({ error: errorText });
    }

    console.log("PDF recibido desde PDFShift.");

    // Recibir binario del PDF
    const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename || "certificado.pdf"}"`
    );

    return res.status(200).send(pdfBuffer);

  } catch (error) {
    console.error("PDF ERROR:", error);
    return res.status(500).json({ error: error.toString() });
  }
}
