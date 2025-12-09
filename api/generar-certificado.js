export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { html } = req.body;
    if (!html) {
      return res.status(400).json({ error: "Missing HTML" });
    }

    const apiKey = process.env.HTML2PDF_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "PDF API key not configured" });
    }

    const response = await fetch("https://api.html2pdf.app/v1/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        html,
        apiKey,
        options: {
          format: "A4",
          margin: "1cm",
          // más opciones si quieres: land­scape, header/footer, etc.
        }
      })
    });

    if (!response.ok) {
      const txt = await response.text();
      return res.status(500).json({ error: "PDF generation failed", details: txt });
    }

    const arrayBuf = await response.arrayBuffer();
    const pdfBuffer = Buffer.from(arrayBuf);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="certificado.pdf"');
    return res.send(pdfBuffer);

  } catch (err) {
    console.error("PDF generation error:", err);
    return res.status(500).json({ error: "Internal server error", details: err.toString() });
  }
}
