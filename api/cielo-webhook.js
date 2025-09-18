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
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey,
      }),
    });
  } else {
    initializeApp({ credential: applicationDefault() });
  }
}
initAdmin();

const db = getFirestore();

/* ---------------- Utils ---------------- */
const pickHeaders = (h = {}) => {
  const allow = [
    "content-type", "content-length", "user-agent",
    "x-forwarded-for", "x-real-ip", "x-vercel-id", "x-request-id",
  ];
  const out = {};
  for (const k of allow) if (h[k]) out[k] = h[k];
  return out;
};

const jlog = (obj) => console.log(JSON.stringify(obj));

async function logToFirestore(entry) {
  try {
    await db.collection("webhookLogs").add(entry);
  } catch (e) {
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
    p?.order_number ??
    p?.OrderNumber ??
    p?.orderNumber ??
    p?.OrderNumberId ??
    p?.orderNumberId ??
    p?.order?.number ??
    "";
  return String(cand || "").trim();
}

function normalizePayment(p) {
  const t = String(p?.Status ?? p?.status ?? "").toLowerCase(); // às vezes vem textual
  const psRaw =
    p?.payment_status ?? p?.PaymentStatus ?? p?.Payment?.Status ?? p?.payment?.status;
  const ps = Number(Array.isArray(psRaw) ? psRaw?.[0] : psRaw);

  // “Pago/confirmado”
  const textPaid = /(paid|pago|paymentconfirmed|captur)/i.test(t);
  // “Autorizado” (pendente de captura/confirm.)
  const textAuth = /(authorized|autorizado|autorizada)/i.test(t);

  let isPaid = false;
  let reason = "unknown";

  if (Number.isFinite(ps)) {
    // Checkout Cielo: 1=pendente, 2=pago, 3=negado, 4=expirado, 5=cancelado
    if (ps === 2) { isPaid = true; reason = "pago"; }
    else if (ps === 1) { isPaid = false; reason = "pendente"; }
    else if (ps === 3) { isPaid = false; reason = "negado"; }
    else if (ps === 4) { isPaid = false; reason = "expirado"; }
    else if (ps === 5) { isPaid = false; reason = "cancelado"; }
  } else {
    // fallback por texto, se por algum motivo não vier ps
    if (textPaid) { isPaid = true; reason = `text:${t}`; }
    else if (textAuth) { isPaid = false; reason = `text:${t}`; }
  }

  return { ps: Number.isFinite(ps) ? ps : null, text: t, isPaid, reason };
}

// YYYY-MM-DD em São Paulo (opcional: útil p/ relatórios/filtros rápidos)
function dateKeySP(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function mapItensToPedido(itens) {
  return (Array.isArray(itens) ? itens : []).map((it) => {
    const precoNum = Number(it?.precoSelecionado ?? it?.preco ?? it?.Price ?? it?.price ?? 0);
    const unitPriceCents = Number(it?.UnitPrice ?? 0);
    const preco = precoNum > 0 ? precoNum : (unitPriceCents > 0 ? Math.round(unitPriceCents) / 100 : 0);

    return {
      id: String(it?.id ?? it?.Id ?? it?.Sku ?? it?.sku ?? ""),
      nome: it?.nome ?? it?.Name ?? "Item",
      observacao: it?.observacao ?? it?.Observacao ?? it?.obs ?? "",
      preco,                                            // em reais
      quantidade: Number(it?.quantidade ?? it?.quantity ?? 1),
      tamanho: it?.tamanho ?? it?.size ?? "pequeno",
      garnicoes: it?.garnicoes ?? it?.extras ?? it?.adicionais ?? it?.opcionais ?? [],
    };
  });
}

function countItens(itens) {
  return (Array.isArray(itens) ? itens : []).reduce((acc, it) => {
    const q = Number(it?.quantidade ?? it?.quantity ?? 1);
    return acc + (Number.isFinite(q) ? q : 0);
  }, 0);
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
      paymentStatusNumeric: norm.ps,
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
      return res.status(200).json({ ok: true, ignored: true, reason: "no-order-number" });
    }

    // Intent do pedido
    const intentsSnap = await db
      .collection("checkoutIntents")
      .where("orderNumber", "==", orderNumber)
      .limit(1)
      .get();
    const intentRef = intentsSnap.empty ? null : intentsSnap.docs[0].ref;
    const intentData = intentsSnap.empty ? {} : intentsSnap.docs[0].data();

    // Atualiza trilha de notificação no intent
    if (intentRef) {
      await intentRef.set({
        lastNotification: FieldValue.serverTimestamp(),
        lastPayload: {
          paymentStatusNumeric: norm.ps,
          paymentStatusText: norm.text,
          raw: parsed,
        },
      }, { merge: true });
    }

    // --- DECISÃO DE STATUS ---
    const ps = norm.ps; // 1 pendente, 2 pago, 3 negado, 4 expirado, 5 cancelado

    // 1) PENDENTE/AUTORIZADO
    if (ps === 1) {
      if (intentRef) await intentRef.set({ status: "pendente" }, { merge: true });
      await logToFirestore({ ...baseLog, stage: "pending-authorized" });
      jlog({ tag: "webhook", stage: "pending-authorized", orderNumber, ps, tookMs: Date.now() - t0 });
      return res.status(200).json({ ok: true, processed: true, approved: false, pending: true });
    }

    // 2) NÃO APROVADO
    if (ps === 3 || ps === 4 || ps === 5) {
      if (intentRef) await intentRef.set({ status: "nao_aprovado" }, { merge: true });
      await logToFirestore({ ...baseLog, stage: "not-approved" });
      jlog({ tag: "webhook", stage: "not-approved", orderNumber, ps, tookMs: Date.now() - t0 });
      return res.status(200).json({ ok: true, processed: true, approved: false });
    }

    // 3) APROVADO (ps === 2) -> cria/atualiza pedido no formato da sua tela
    if (ps === 2 || norm.isPaid) {
      const origItens = Array.isArray(intentData?.itens) ? intentData.itens : [];
      const itens = mapItensToPedido(origItens);
      const total = Number(intentData?.total ?? 0);
      const itensCount = countItens(itens);

      const orderNumStr = String(orderNumber);

      // nome/telefone se você guardou no intent (opcional)
      const clienteNome = intentData?.nome || intentData?.clienteNome || "";
      const clienteTelefone = intentData?.telefone || intentData?.clienteTelefone || "";

      const pagamentoData = {
        provedor: "online",
        gateway: "cielo",
        orderNumber: orderNumStr,
        status: "aprovado",                  // igual ao “No caixa”
        paymentStatus: 2,
        raw: parsed,
        lastNotification: FieldValue.serverTimestamp(),
      };

      const basePedido = {
        orderNumber: orderNumStr,            // top-level p/ busca
        dateKeySP: dateKeySP(),              // opcional p/ relatórios de HOJE
        tipoServico: intentData?.tipoServico || "Online",
        status: "aprovado",
        total,
        itens,
        itensCount,
        nome: clienteNome,
        telefone: clienteTelefone,
        pagamento: pagamentoData,
        updatedAt: FieldValue.serverTimestamp(),
      };

      const pedidosSnap = await db
        .collection("pedidos")
        .where("pagamento.orderNumber", "==", orderNumStr)
        .limit(1)
        .get();

      if (pedidosSnap.empty) {
        await db.collection("pedidos").add({
          ...basePedido,
          createdAt: FieldValue.serverTimestamp(), // ESSENCIAL p/ cair no filtro de HOJE
        });
        await logToFirestore({ ...baseLog, stage: "pedido-created", wrote: { orderNumber: orderNumStr } });
        jlog({ tag: "webhook", stage: "pedido-created", orderNumber: orderNumStr, tookMs: Date.now() - t0 });
      } else {
        const ref = pedidosSnap.docs[0].ref;
        await ref.set(
          {
            ...basePedido,
            createdAt: pedidosSnap.docs[0].get("createdAt") || FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        await logToFirestore({ ...baseLog, stage: "pedido-updated", wrote: { orderNumber: orderNumStr } });
        jlog({ tag: "webhook", stage: "pedido-updated", orderNumber: orderNumStr, tookMs: Date.now() - t0 });
      }

      if (intentRef) await intentRef.set({ status: "aprovado" }, { merge: true });

      return res.status(200).json({ ok: true, processed: true, approved: true });
    }

    // 4) Status desconhecido
    await logToFirestore({ ...baseLog, stage: "unknown-status" });
    jlog({ tag: "webhook", stage: "unknown-status", orderNumber, norm, tookMs: Date.now() - t0 });
    return res.status(200).json({ ok: true, processed: false, approved: false });
  } catch (e) {
    jlog({ tag: "webhook", stage: "exception", err: e?.message || String(e) });
    await logToFirestore({
      at: FieldValue.serverTimestamp(),
      route: "/api/cielo-webhook",
      stage: "exception",
      error: e?.message || String(e),
    });
    // Sempre 200 para não gerar retentativas agressivas
    return res.status(200).json({ ok: false, error: e?.message || String(e) });
  }
}
