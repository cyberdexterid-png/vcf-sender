const express = require("express");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_API_VERSION;
const SEND_INTERVAL_MS = 30_000;

// This is a local, opt-in sender using the official WhatsApp Business Cloud API.
// It deliberately does not connect to or automate a personal Linked Device.
let lastSendAt = 0;
const recentRecipients = new Map();

app.disable("x-powered-by");
app.use(express.json({ limit: "16kb" }));
app.use(express.static(path.join(__dirname, "public"), {
  dotfiles: "deny", index: "index.html", etag: true, maxAge: "1h"
}));

app.get("/health", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({
    ok: true,
    app: "XHYPER VCF SENDER V2",
    mode: "local-opt-in",
    provider: "WhatsApp Business Cloud API",
    configured: Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID && GRAPH_VERSION)
  });
});

app.post("/api/send", async (req, res) => {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId || !GRAPH_VERSION) {
    return res.status(503).json({ ok: false, error: "WhatsApp Cloud API is not configured. Set WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_GRAPH_API_VERSION." });
  }

  const phone = String(req.body?.phone || "").replace(/\D/g, "");
  const message = String(req.body?.message || "").trim();
  const consentConfirmed = req.body?.consentConfirmed === true;
  if (!consentConfirmed) return res.status(400).json({ ok: false, error: "Recipient consent must be confirmed before sending." });
  if (phone.length < 8 || phone.length > 15) return res.status(400).json({ ok: false, error: "Enter a valid international phone number." });
  if (!message || message.length > 4096) return res.status(400).json({ ok: false, error: "Message must contain 1–4096 characters." });

  const now = Date.now();
  if (now - lastSendAt < SEND_INTERVAL_MS) {
    const waitSeconds = Math.ceil((SEND_INTERVAL_MS - (now - lastSendAt)) / 1000);
    return res.status(429).json({ ok: false, error: "Local sending pace limit. Please wait before the next recipient.", waitSeconds });
  }
  const lastTo = recentRecipients.get(phone) || 0;
  if (now - lastTo < 24 * 60 * 60 * 1000) {
    return res.status(409).json({ ok: false, error: "This recipient was already sent a message from this running session in the last 24 hours." });
  }

  try {
    const response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: phone,
        type: "text",
        text: { preview_url: false, body: message }
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(response.status).json({ ok: false, error: data.error?.message || "WhatsApp Cloud API rejected the message." });
    }
    lastSendAt = Date.now();
    recentRecipients.set(phone, lastSendAt);
    return res.json({ ok: true, messageId: data.messages?.[0]?.id || null });
  } catch (_error) {
    return res.status(502).json({ ok: false, error: "Could not reach WhatsApp Cloud API." });
  }
});

app.listen(PORT, HOST, () => {
  console.log(`XHYPER VCF SENDER V2 running at http://${HOST}:${PORT}`);
  console.log("Local-only server. Use only for recipients who explicitly opted in.");
});
