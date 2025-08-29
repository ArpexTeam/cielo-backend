// index.js
import express from "express";
import dotenv from "dotenv";
import checkoutRoute from "./checkout.js";

dotenv.config();

const app = express();
app.use(express.json());

// monta as rotas sob /api
app.use("/api", checkoutRoute);

// (opcional) healthcheck raiz
app.get("/health", (_req, res) => res.json({ ok: true }));

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`Backend rodando na porta ${port}`);
});
