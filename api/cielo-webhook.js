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
    // trata caso a chave tenha vindo com aspas e com "\n"
    let privateKey = process.env.FIREBASE_PRIVATE_KEY;
    if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
      privateKey = privateKey.slice(1, -1);
    }
    privateKey = privateKey.replace(/\\n/g, "\n");

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
    "content-type",
    "content-length",
    "user-agent",
    "x-forwarded-for",
    "x-real-ip",
    "x-vercel-id",
    "x-request-id",
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
    if (ps === 2) {
      isPaid = true;
      reason = "pago";
    } else if (ps === 1) {
      isPaid = false;
      reason = "pendente";
    } else if (ps === 3) {
      isPaid = false;
      reason = "negado";
    } else if (ps === 4) {
      isPaid = false;
      reason = "expirado";
    } else if (ps === 5) {
      isPaid = false;
      reason = "cancelado";
    }
  } else {
    if (textPaid) {
      isPaid = true;
      reason = `text:${t}`;
    } else if (textAuth) {
      isPaid = false;
      reason = `text:${t}`;
    }
  }

  return { ps: Number.isFinite(ps) ? ps : null, text: t, isPaid, reason };
}

// YYYY-MM-DD em São Paulo
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
    const preco =
      precoNum > 0 ? precoNum : unitPriceCents > 0 ? Math.round(unitPriceCents) / 100 : 0;

    return {
      id: String(it?.id ?? it?.Id ?? it?.Sku ?? it?.sku ?? ""),
      nome: it?.nome ?? it?.Name ?? "Item",
      observacao: it?.observacao ?? it?.Observacao ?? it?.obs ?? "",
      preco,
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

// verifica se um documento de "pedidos" é de HOJE (SP)
function isDocFromToday(docSnap) {
  const todayKey = dateKeySP();
  const docKey = docSnap.get("dateKeySP");
  if (docKey) return String(docKey) === todayKey;

  const createdAt = docSnap.get("createdAt");
  if (!createdAt || typeof createdAt.toDate !== "function") return false;
  const createdKey = dateKeySP(createdAt.toDate());
  return createdKey === todayKey;
}

// tenta localizar o intent de forma robusta
async function findIntentByOrderNumber(orderNumber) {
  const orderKey = String(orderNumber || "").trim();
  if (!orderKey) return { ref: null, data: null, from: "empty" };

  // 1) tentativa rápida: igualdade exata (string)
  let snap = await db
    .collection("checkoutIntents")
    .where("orderNumber", "==", orderKey)
    .limit(1)
    .get();

  if (!snap.empty) {
    return { ref: snap.docs[0].ref, data: snap.docs[0].data(), from: "where" };
  }

  // 2) fallback: varrer últimos intents e comparar normalizando
  snap = await db
    .collection("checkoutIntents")
    .orderBy("createdAt", "desc")
    .limit(30)
    .get();

  let found = null;
  snap.forEach((d) => {
    if (found) return;
    const data = d.data() || {};
    const on = String(data.orderNumber ?? "").trim();
    if (on === orderKey) {
      found = { ref: d.ref, data, from: "fallback-scan" };
    }
  });

  return found || { ref: null, data: null, from: "not-found" };
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
    const orderNumberRaw = getOrderNumber(parsed);
    const orderNumber = String(orderNumberRaw || "").trim();
    const norm = normalizePayment(parsed);

    // tenta achar o intent
    const intentInfo = await findIntentByOrderNumber(orderNumber);
    const intentRef = intentInfo?.ref || null;
    const intentData = intentInfo?.data || {};
    const intentSource = intentInfo?.from || "none";

    const baseLog = {
      at: FieldValue.serverTimestamp(),
      vercelId,
      route: "/api/cielo-webhook",
      method: req.method,
      contentType,
      headers,
      orderNumber,
      intentSource,
      intentFound: !!intentRef,
      paymentStatusNumeric: norm.ps,
      paymentStatusText: norm.text || null,
      isPaid: !!norm.isPaid,
      reason: norm.reason,
      rawLen: raw ? raw.length : null,
      parsedSample: JSON.stringify(parsed).slice(0, 4000),
    };

    await logToFirestore({ ...baseLog, stage: "received" });
    jlog({ tag: "webhook", stage: "received", orderNumber, norm, intentSource, vercelId });

    if (!orderNumber) {
      await logToFirestore({ ...baseLog, stage: "no-order-number" });
      return res.status(200).json({ ok: true, ignored: true, reason: "no-order-number" });
    }

    // Dados do cliente/agendamento vindos do intent (se houver)
    const nome = intentData?.cliente?.nome ?? intentData?.nome ?? "";
    const telefone = intentData?.cliente?.telefone ?? intentData?.telefone ?? "";
    const observacoes = intentData?.cliente?.observacoes ?? intentData?.observacoes ?? "";
    const agendamento = intentData?.agendamento ?? null;
    const tipoServico = intentData?.tipoServico ?? (agendamento ? "Agendamento" : "Online");

    if (intentRef) {
      await intentRef.set(
        {
          lastNotification: FieldValue.serverTimestamp(),
          lastPayload: {
            paymentStatusNumeric: norm.ps,
            paymentStatusText: norm.text,
            raw: parsed,
          },
        },
        { merge: true }
      );
    }

    const ps = norm.ps;

    // 1) Pendente / Autorizado
    if (ps === 1) {
      if (intentRef) await intentRef.set({ status: "pendente" }, { merge: true });
      await logToFirestore({ ...baseLog, stage: "pending-authorized" });
      return res
        .status(200)
        .json({ ok: true, processed: true, approved: false, pending: true });
    }

    // 2) Não aprovado
    if (ps === 3 || ps === 4 || ps === 5) {
      if (intentRef) await intentRef.set({ status: "nao_aprovado" }, { merge: true });
      await logToFirestore({ ...baseLog, stage: "not-approved" });
      return res.status(200).json({ ok: true, processed: true, approved: false });
    }

    // 3) Aprovado (ps=2)
    if (ps === 2 || norm.isPaid) {
      const origItens = Array.isArray(intentData?.itens) ? intentData.itens : [];
      const itens = mapItensToPedido(origItens);
      const total = Number(intentData?.total ?? 0);
      const itensCount = countItens(itens);

      const orderNumStr = String(orderNumber);

      const pagamentoData = {
        provedor: "online",
        gateway: "cielo",
        orderNumber: orderNumStr,
        status: "aprovado",
        paymentStatus: 2,
        raw: parsed,
        lastNotification: FieldValue.serverTimestamp(),
      };

      const basePedido = {
        orderNumber: orderNumStr,
        dateKeySP: dateKeySP(),
        tipoServico,
        status: "aprovado",
        total,
        itens,
        itensCount,
        // dados do cliente/agendamento:
        nome,
        telefone,
        observacoes,
        ...(agendamento ? { agendamento } : {}),
        pagamento: pagamentoData,
        updatedAt: FieldValue.serverTimestamp(),
      };

      // Só considera docs de HOJE com o mesmo orderNumber
      const possiveis = await db
        .collection("pedidos")
        .where("pagamento.orderNumber", "==", orderNumStr)
        .limit(5)
        .get();

      let docHoje = null;
      possiveis.forEach((d) => {
        if (!docHoje && isDocFromToday(d)) docHoje = d;
      });

      if (!docHoje) {
        await db.collection("pedidos").add({
          ...basePedido,
          createdAt: FieldValue.serverTimestamp(),
        });
        await logToFirestore({
          ...baseLog,
          stage: "pedido-created",
          wrote: { orderNumber: orderNumStr },
        });
        jlog({
          tag: "webhook",
          stage: "pedido-created",
          orderNumber: orderNumStr,
          intentSource,
          tookMs: Date.now() - t0,
        });
      } else {
        await docHoje.ref.set(
          {
            ...basePedido,
            createdAt: docHoje.get("createdAt") || FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        await logToFirestore({
          ...baseLog,
          stage: "pedido-updated",
          wrote: { orderNumber: orderNumStr, docId: docHoje.id },
        });
        jlog({
          tag: "webhook",
          stage: "pedido-updated",
          orderNumber: orderNumStr,
          intentSource,
          tookMs: Date.now() - t0,
        });
      }

      if (intentRef) await intentRef.set({ status: "aprovado" }, { merge: true });

      return res.status(200).json({ ok: true, processed: true, approved: true });
    }

    // 4) Desconhecido
    await logToFirestore({ ...baseLog, stage: "unknown-status" });
    jlog({
      tag: "webhook",
      stage: "unknown-status",
      orderNumber,
      intentSource,
      norm,
      tookMs: Date.now() - t0,
    });
    return res.status(200).json({ ok: true, processed: false, approved: false });
  } catch (e) {
    jlog({ tag: "webhook", stage: "exception", err: e?.message || String(e) });
    await logToFirestore({
      at: FieldValue.serverTimestamp(),
      route: "/api/cielo-webhook",
      stage: "exception",
      error: e?.message || String(e),
    });
    // 200 para evitar retentativas agressivas
    return res.status(200).json({ ok: false, error: e?.message || String(e) });
  }
}
