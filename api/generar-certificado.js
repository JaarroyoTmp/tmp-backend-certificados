import pdfcrowd from "pdfcrowd";

export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed" });
    }

    try {
        const { html } = req.body;

        if (!html) {
            return res.status(400).json({ error: "Missing HTML content" });
        }

        // Crear cliente PDFCrowd
        const client = new pdfcrowd.HtmlToPdfClient(
            process.env.PDFCROWD_USERNAME,
            process.env.PDFCROWD_API_KEY
        );

        // Convertir HTML a PDF usando el SDK correcto
        const pdfData = await new Promise((resolve, reject) => {
            client.convertString(
                html,
                (data) => resolve(Buffer.from(data)),   // convertimos array → Buffer
                (err) => reject(err)
            );
        });

        // Enviar PDF al navegador
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", "attachment; filename=certificado.pdf");
        return res.send(pdfData);

    } catch (error) {
        console.error("PDFCrowd error:", error);
        return res.status(500).json({
            error: "Error generating PDF",
            details: error.toString()
        });
    }
}
