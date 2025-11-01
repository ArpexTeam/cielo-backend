// api/qz/cert.js
import fs from "fs";
import path from "path";

const CERT_PATH = path.join(process.cwd(), "api", "certs", "qz-public.crt");
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";

let CERT_CACHE = null;

export default function handler(req, res) {
  // CORS básico
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).end("Method not allowed");

  try {
    if (!CERT_CACHE) {
      CERT_CACHE = fs.readFileSync(CERT_PATH, "utf8");
    }
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.status(200).send(CERT_CACHE);
  } catch (e) {
    return res.status(500).json({ error: "cert-not-found", details: e?.message });
  }
}

// Garante runtime Node (se seu projeto usar Edge em outras rotas)
export const config = { runtime: "nodejs" };
