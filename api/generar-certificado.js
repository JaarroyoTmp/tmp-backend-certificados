export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { html } = req.body;

    if (!html) {
      return res.status(400).json({ error: "Missing HTML content" });
    }

    const apiKey = process.env.HTML2PDF_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "API key missing" });
    }

    const response = await fetch("https://api.html2pdf.app/v1/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        html,
        apiKey
      })
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(500).json({
        error: "Error generating PDF",
        details: text
      });
    }

    const pdfBuffer = Buffer.from(await response.arrayBuffer());

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=certificado.pdf");

    return res.send(pdfBuffer);

  } catch (error) {
    return res.status(500).json({
      error: "Unexpected server error",
      details: error.toString()
    });
  }
}
