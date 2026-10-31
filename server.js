const express = require("express");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const AUTH_DIR = path.join(__dirname, "auth_data_local");

let socket = null;
let waStatus = "disconnected";
let qrCodeDataUrl = null;
let pairedNumber = null;
let lastError = null;
let starting = false;

app.disable("x-powered-by");
app.use(express.json({ limit: "8kb" }));
app.use(express.static(path.join(__dirname, "public"), {
  dotfiles: "deny", index: "index.html", etag: true, maxAge: "1h"
}));

app.get("/health", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ ok: true, app: "XHYPER VCF SENDER V2", mode: "local-linked-device-pairing", apiRequired: false });
});

app.get("/api/whatsapp/status", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ status: waStatus, qrCodeDataUrl, error: lastError });
});

app.post("/api/whatsapp/pair", async (req, res) => {
  const phone = String(req.body?.phone || "").replace(/\D/g, "");
  if (phone.length < 8 || phone.length > 15) {
    return res.status(400).json({ ok: false, error: "Enter your phone number with country code, digits only." });
  }
  if (starting || (socket && waStatus === "connected")) {
    return res.status(409).json({ ok: false, error: "A WhatsApp session is already starting or connected." });
  }

  starting = true;
  qrCodeDataUrl = null;
  lastError = null;
  waStatus = "connecting";

  try {
    const { default: makeWASocket, useMultiFileAuthState } = await import("@whiskeysockets/baileys");
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    socket = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      markOnlineOnConnect: false,
      syncFullHistory: false
    });

    socket.ev.on("creds.update", saveCreds);
    socket.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (connection === "open") {
        waStatus = "connected";
        qrCodeDataUrl = null;
        lastError = null;
        starting = false;
      } else if (connection === "close") {
        waStatus = "disconnected";
        qrCodeDataUrl = null;
        starting = false;
        const reason = lastDisconnect?.error?.message;
        if (reason) lastError = reason;
        socket = null;
      }
      if (qr && !state.creds.registered) {
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

    return res.json({ ok: true, message: state.creds.registered ? "Saved session is reconnecting." : "Connection started. Your QR code will appear shortly." });
  } catch (error) {
    starting = false;
    waStatus = "error";
    lastError = error?.message || "Could not start WhatsApp connection.";
    return res.status(500).json({ ok: false, error: lastError });
  }
});

app.post("/api/whatsapp/disconnect", async (_req, res) => {
  try {
    if (socket) socket.end(undefined);
  } catch (_error) {}
  socket = null;
  starting = false;
  qrCodeDataUrl = null;
  waStatus = "disconnected";
  return res.json({ ok: true, status: waStatus });
});

app.listen(PORT, HOST, () => {
  console.log(`XHYPER VCF SENDER V2 running at http://${HOST}:${PORT}`);
  console.log("Local-only server. Pair only your own WhatsApp account.");
});
