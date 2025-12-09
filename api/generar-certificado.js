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

        const client = new pdfcrowd.HtmlToPdfClient(
            process.env.PDFCROWD_USERNAME,
            process.env.PDFCROWD_API_KEY
        );

        // STREAM del PDF directamente a memoria para enviarlo después
        const chunks = [];
        
        await client.convertStringToStream(
            html,
            (chunk) => chunks.push(chunk),   // recibe datos
            (err) => { throw err; }          // maneja errores
        );

        const pdfBuffer = Buffer.concat(chunks);

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", 'inline; filename="certificado.pdf"');
        res.send(pdfBuffer);

    } catch (error) {
        console.error("PDFCrowd error:", error);
        return res.status(500).json({
            error: "Error generating PDF",
            details: error.toString()
        });
    }
}
