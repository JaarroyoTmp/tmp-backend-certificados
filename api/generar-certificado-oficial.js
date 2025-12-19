export const config = {
  api: {
    bodyParser: {
      sizeLimit: "15mb",
    },
  },
  runtime: "nodejs",
};

export default async function handler(req, res) {
  console.log("🔥 HANDLER EJECUTADO");

  // CORS
  res.setHeader(
    "Access-Control-Allow-Origin",
    "https://trazabilidad-tmp.vercel.app"
  );
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    console.log("🟡 OPTIONS OK");
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    console.log("🔴 MÉTODO NO PERMITIDO:", req.method);
    return res.status(405).json({ error: "Método no permitido" });
  }

  console.log("🟢 POST RECIBIDO");
  console.log("📦 BODY:", req.body);

  return res.status(200).json({
    ok: true,
    mensaje: "BACKEND FUNCIONANDO",
    recibido: true,
  });
}
