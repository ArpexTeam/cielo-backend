// api/cielo-webhook.js
import { parse as parseQS } from "querystring";
import { initializeApp, cert, applicationDefault, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

/* ---------------- Firebase Admin ---------------- */
function initAdmin() {
  if (getApps().length) return;
  const hasSA =
    process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_CLIENT_EMAIL &&
    process.env.FIREBASE_PRIVATE_KEY;

  if (hasSA) {
    const privateKey = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n");
    initializeApp({ credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey,
    })});
  } else {
    initializeApp({ credential: applicationDefault() });
  }
}
initAdmin();
const db = getFirestore();

/* ---------------- Utils ---------------- */
const pickHeaders = (h) => {
  const allow = [
    "content-type","content-length","user-agent","x-forwarded-for","x-real-ip",
    "x-vercel-id","x-request-id"
  ];
  const out = {};
  for (const k of allow) if (h[k]) out[k] = h[k];
  return out;
};

const jlog = (obj) => console.log(JSON.stringify(obj));

async function logToFirestore(entry) {
  try { await db.collection("webhookLogs").add(entry); } catch (e) {
    console.warn("webhookLogs write failed:", e?.message || e);
  }
}

async function readRawBody(req) {
  return await new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

async function parseBody(req) {
  let raw = null;
  let body = req.body;

  if (body == null || body === "") {
    raw = await readRawBody(req);
    if (!raw) return { parsed: {}, raw, contentType: req.headers["content-type"] || "" };
    try {
      return { parsed: JSON.parse(raw), raw, contentType: req.headers["content-type"] || "" };
    } catch {
      return { parsed: parseQS(raw), raw, contentType: req.headers["content-type"] || "" };
    }
  }

  if (typeof body === "string") {
    try {
      return { parsed: JSON.parse(body), raw: body, contentType: req.headers["content-type"] || "" };
    } catch {
      return { parsed: parseQS(body), raw: body, contentType: req.headers["content-type"] || "" };
    }
  }
  return { parsed: body, raw: null, contentType: req.headers["content-type"] || "" };
}

function getOrderNumber(p) {
  const cand =
    p?.order_number ?? p?.OrderNumber ?? p?.orderNumber ??
    p?.OrderNumberId ?? p?.orderNumberId ?? p?.order?.number ?? "";
  return String(cand || "").trim();
}

function normalizePayment(p) {
  const text = String(p?.Status ?? p?.status ?? "").toLowerCase();
  const psRaw =
    p?.payment_status ?? p?.PaymentStatus ?? p?.Payment?.Status ?? p?.payment?.status;
  const ps = Number(Array.isArray(psRaw) ? psRaw?.[0] : psRaw);
  // Cielo Checkout: 1=Pendente, 2=Pago, 3=Negado, 4=Expirado, 5=Cancelado
  const isPaid = ps === 2 || /^paid|pago|captur/i.test(text);
  let reason = "unknown";
  if (ps === 1) reason = "pendente";
  if (ps === 2) reason = "pago";
  if (ps === 3) reason = "negado";
  if (ps === 4) reason = "expirado";
  if (ps === 5) reason = "cancelado";
  if (reason === "unknown" && text) reason = `text:${text}`;
  return { ps, text, isPaid, reason };
}

/* ---------------- Handler ---------------- */
export default async function handler(req, res) {
  const t0 = Date.now();
  if (req.method !== "POST") {
    return res.status(200).json({ ok: true, ignored: true, reason: "not-post" });
  }

  const headers = pickHeaders(req.headers || {});
  const vercelId = headers["x-vercel-id"] || null;

  try {
    const { parsed, raw, contentType } = await parseBody(req);
    const orderNumber = getOrderNumber(parsed);
    const norm = normalizePayment(parsed);

    const baseLog = {
      at: FieldValue.serverTimestamp(),
      vercelId,
      route: "/api/cielo-webhook",
      method: req.method,
      contentType,
      headers,
      orderNumber,
      paymentStatusNumeric: Number.isFinite(norm.ps) ? norm.ps : null,
      paymentStatusText: norm.text || null,
      isPaid: !!norm.isPaid,
      reason: norm.reason,
      rawLen: raw ? raw.length : null,
      parsedSample: JSON.stringify(parsed).slice(0, 4000), // evita estourar doc
    };

    await logToFirestore({ ...baseLog, stage: "received" });
    jlog({ tag: "webhook", stage: "received", orderNumber, norm, vercelId });

    if (!orderNumber) {
      await logToFirestore({ ...baseLog, stage: "no-order-number" });
      jlog({ tag: "webhook", stage: "no-order-number", vercelId });
      return res.status(200).json({ ok: true, ignored: true, reason: "no-order-number" });
    }

    // Busca intent
    const intentsSnap = await db
      .collection("checkoutIntents")
      .where("orderNumber", "==", orderNumber)
      .limit(1)
      .get();
    const intentRef = intentsSnap.empty ? null : intentsSnap.docs[0].ref;
    const intentData = intentsSnap.empty ? {} : intentsSnap.docs[0].data();

    // Atualiza intent com última notificação + dump do payload
    if (intentRef) {
      await intentRef.set({
        lastNotification: FieldValue.serverTimestamp(),
        lastPayload: { paymentStatusNumeric: norm.ps, paymentStatusText: norm.text, raw: parsed },
      }, { merge: true });
    }

    if (!norm.isPaid) {
      if (intentRef) {
        await intentRef.set({ status: "nao_aprovado" }, { merge: true });
      }
      await logToFirestore({ ...baseLog, stage: "not-approved" });
      jlog({ tag: "webhook", stage: "not-approved", orderNumber, norm, tookMs: Date.now() - t0 });
      return res.status(200).json({ ok: true, processed: true, approved: false });
    }

    // Pago → cria/atualiza pedido
    const itens = Array.isArray(intentData?.itens) ? intentData.itens : [];
    const total = Number(intentData?.total ?? 0);

    if (!intentRef) {
      await logToFirestore({ ...baseLog, stage: "paid-without-intent" });
      await db.collection("webhookOrphans").add({
        createdAt: FieldValue.serverTimestamp(),
        orderNumber,
        payload: parsed,
      });
      return res.status(200).json({ ok: true, processed: true, approved: true, pendingIntent: true });
    }

    const pedidosSnap = await db
      .collection("pedidos")
      .where("pagamento.orderNumber", "==", orderNumber)
      .limit(1)
      .get();

    const pagamentoData = {
      provedor: "online",
      gateway: "cielo",
      orderNumber,
      raw: parsed,
      lastNotification: FieldValue.serverTimestamp(),
    };

    if (pedidosSnap.empty) {
      await db.collection("pedidos").add({
        createdAt: FieldValue.serverTimestamp(),
        itens, total,
        status: "aprovado",
        tipoServico: "Online",
        pagamento: pagamentoData,
      });
      await logToFirestore({ ...baseLog, stage: "pedido-created" });
      jlog({ tag: "webhook", stage: "pedido-created", orderNumber, tookMs: Date.now() - t0 });
    } else {
      await pedidosSnap.docs[0].ref.set(
        { status: "aprovado", pagamento: pagamentoData },
        { merge: true }
      );
      await logToFirestore({ ...baseLog, stage: "pedido-updated" });
      jlog({ tag: "webhook", stage: "pedido-updated", orderNumber, tookMs: Date.now() - t0 });
    }

    await intentRef.set({ status: "aprovado" }, { merge: true });

    return res.status(200).json({ ok: true, processed: true, approved: true });
  } catch (e) {
    jlog({ tag: "webhook", stage: "exception", err: e?.message || String(e) });
    await logToFirestore({
      at: FieldValue.serverTimestamp(),
      route: "/api/cielo-webhook",
      stage: "exception",
      error: e?.message || String(e),
    });
    return res.status(200).json({ ok: false, error: e?.message || String(e) });
  }
}
