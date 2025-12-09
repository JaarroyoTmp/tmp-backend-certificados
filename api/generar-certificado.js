const pdfcrowd = require("pdfcrowd");

export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed" });
    }

    try {
        const { html } = req.body;

        if (!html) {
            return res.status(400).json({ error: "Missing HTML content" });
        }

        // Credenciales desde Vercel
        const username = process.env.PDFCROWD_USERNAME;
        const apiKey = process.env.PDFCROWD_API_KEY;

        // Crear cliente PDFCrowd
        const client = new pdfcrowd.HtmlToPdfClient(username, apiKey);

        // Convertir HTML → PDF (PDFCrowd trabaja con callbacks)
        const pdfBuffer = await new Promise((resolve, reject) => {
            client.convertString(html,
                (pdf) => resolve(Buffer.from(pdf)),
                (err) => reject(err)
            );
        });

        // Respuesta hacia el navegador
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", "inline; filename=certificado.pdf");
        return res.send(pdfBuffer);

    } catch (error) {
        console.error("PDFCrowd error:", error);
        return res.status(500).json({
            error: "Error generating PDF",
            details: error.toString()
        });
    }
}
