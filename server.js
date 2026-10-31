const express = require("express");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const AUTH_DIR = path.join(__dirname, "auth_data_local");

let socket = null;
let waStatus = "disconnected";
let qrCodeDataUrl = null;
let lastError = null;
let starting = false;
let manuallyDisconnected = false;

app.disable("x-powered-by");
app.use(express.json({ limit: "8kb" }));
app.use(express.static(path.join(__dirname, "public"), {
  dotfiles: "deny", index: "index.html", etag: true, maxAge: "1h"
}));

app.get("/health", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ ok: true, app: "XHYPER VCF SENDER V2", mode: "local-linked-device-qr", apiRequired: false });
});

app.get("/api/whatsapp/status", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ status: waStatus, qrCodeDataUrl, error: lastError });
});

async function startWhatsAppSocket() {
  const { default: makeWASocket, useMultiFileAuthState } = await import("@whiskeysockets/baileys");
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  const currentSocket = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    syncFullHistory: false
  });
  socket = currentSocket;

  // Process events serially so updated login credentials are persisted
  // before a restart-required (515) close event is handled.
  currentSocket.ev.process(async (events) => {
    if (events["creds.update"]) {
      await saveCreds();
    }

    const update = events["connection.update"];
    if (!update) return;

    const { connection, lastDisconnect, qr } = update;

    if (connection === "open") {
      waStatus = "connected";
      qrCodeDataUrl = null;
      lastError = null;
      starting = false;
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const reason = lastDisconnect?.error?.message;
      if (socket === currentSocket) socket = null;
      qrCodeDataUrl = null;

      // WhatsApp normally closes with 515 immediately after a successful
      // QR link. Re-open the socket using the newly saved credentials.
      if (statusCode === 515 && !manuallyDisconnected) {
        waStatus = "connecting";
        starting = true;
        lastError = null;
        try {
          await startWhatsAppSocket();
        } catch (error) {
          waStatus = "error";
          starting = false;
          lastError = error?.message || "Could not restart WhatsApp after QR linking.";
        }
        return;
      }

      waStatus = "disconnected";
      starting = false;
      if (reason) lastError = reason;
    }

    if (qr && !state.creds.registered && !manuallyDisconnected) {
      try {
        const QRCode = (await import("qrcode")).default;
        qrCodeDataUrl = await QRCode.toDataURL(qr, { width: 280, margin: 2 });
        waStatus = "pairing";
        starting = false;
      } catch (error) {
        lastError = error?.message || "Could not generate QR code.";
        waStatus = "error";
        starting = false;
      }
    }
  });

  return state.creds.registered;
}

app.post("/api/whatsapp/pair", async (_req, res) => {
  if (starting || (socket && waStatus === "connected")) {
    return res.status(409).json({ ok: false, error: "A WhatsApp session is already starting or connected." });
  }

  starting = true;
  manuallyDisconnected = false;
  qrCodeDataUrl = null;
  lastError = null;
  waStatus = "connecting";

  try {
    const alreadyRegistered = await startWhatsAppSocket();
    return res.json({
      ok: true,
      message: alreadyRegistered
        ? "Saved WhatsApp session is reconnecting."
        : "Connection started. Your QR code will appear shortly."
    });
  } catch (error) {
    starting = false;
    waStatus = "error";
    lastError = error?.message || "Could not start WhatsApp connection.";
    return res.status(500).json({ ok: false, error: lastError });
  }
});

app.post("/api/whatsapp/disconnect", async (_req, res) => {
  manuallyDisconnected = true;
  const activeSocket = socket;
  socket = null;
  starting = false;
  qrCodeDataUrl = null;
  waStatus = "disconnected";
  try {
    if (activeSocket) activeSocket.end(undefined);
  } catch (_error) {}
  return res.json({ ok: true, status: waStatus });
});

app.listen(PORT, HOST, () => {
  console.log(`XHYPER VCF SENDER V2 running at http://${HOST}:${PORT}`);
  console.log("Local-only server. Pair only your own WhatsApp account.");
});
