const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const { Server } = require("socket.io");
const pino = require("pino");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const AUTH_DIR = path.join(__dirname, "auth_data_local");
const DB_FILE = path.join(__dirname, "database.json");

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (_req, res) => {
  res.type("html").send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Safe Sender Pro</title>
<style>
*{box-sizing:border-box}
body{
  margin:0;min-height:100vh;background:#0b1020;color:#eef2ff;
  font:16px system-ui,sans-serif;display:grid;place-items:center;padding:24px
}
main{
  width:min(680px,100%);background:#141b2e;
  border:1px solid #29334e;border-radius:20px;padding:28px;
  box-shadow:0 20px 70px #0005
}
h1{margin:0 0 8px;font-size:clamp(26px,5vw,38px)}
p{color:#b9c4dc;line-height:1.6}
.pill{
  display:inline-block;background:#183d34;color:#a7f3d0;
  border-radius:999px;padding:6px 12px;font-size:13px
}
button{
  background:#6d5dfc;color:white;border:0;border-radius:10px;
  padding:12px 16px;font-weight:700;cursor:pointer;margin:4px
}
pre{
  white-space:pre-wrap;overflow-wrap:anywhere;background:#0a0f1d;
  border-radius:10px;padding:12px;color:#b9c4dc;min-height:64px
}
small{color:#94a3b8}
</style>
</head>
<body>
<main>
<span class="pill">LOCAL SERVER</span>
<h1>Safe Sender Pro</h1>
<p>Server is running. MongoDB and login are disabled.</p>
<p>
<button id="check">Check server</button>
<button id="wa">Connect WhatsApp</button>
</p>
<pre id="status">Ready.</pre>
<small>http://127.0.0.1:3000</small>
</main>
<script>
const statusEl = document.getElementById("status");

document.getElementById("check").onclick = async () => {
  try {
    const response = await fetch("/health");
    const data = await response.json();
    statusEl.textContent =
      "Server OK\\n" + JSON.stringify(data, null, 2);
  } catch (error) {
    statusEl.textContent = "Error: " + error.message;
  }
};

document.getElementById("wa").onclick = () => {
  statusEl.textContent =
    "WhatsApp connection request sent.";
  if (window.io) {
    const socket = window.io();
    socket.emit("connect_whatsapp");
    socket.on("info", message => {
      statusEl.textContent = message;
    });
    socket.on("wa_connected", () => {
      statusEl.textContent = "WhatsApp connected.";
    });
  } else {
    statusEl.textContent =
      "Socket.IO client is not loaded.";
  }
};
</script>
</body>
</html>`);
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, database: "local-json" });
});

function readDatabase() {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(DB_FILE, "utf8")
    );

    return {
      users:
        parsed && typeof parsed.users === "object"
          && parsed.users ? parsed.users : {},
      license_keys: Array.isArray(parsed?.license_keys)
        ? parsed.license_keys : []
    };
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error("database.json error:", error.message);
    }

    return { users: {}, license_keys: [] };
  }
}

function writeDatabase(data) {
  const temp = `${DB_FILE}.tmp`;

  fs.writeFileSync(
    temp,
    JSON.stringify(data, null, 2),
    { encoding: "utf8", mode: 0o600 }
  );

  fs.renameSync(temp, DB_FILE);
}

let waSocket = null;
let waStarting = false;

async function startWhatsApp(socket) {
  if (waStarting) {
    socket.emit("info", "WhatsApp connection is starting.");
    return;
  }

  if (waSocket) {
    socket.emit("info", "WhatsApp is already connecting.");
    return;
  }

  waStarting = true;

  try {
    const { state, saveCreds } =
      await useMultiFileAuthState(AUTH_DIR);

    const { version } =
      await fetchLatestBaileysVersion();

    waSocket = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: "silent" }),
      printQRInTerminal: false
    });

    waSocket.ev.on("creds.update", saveCreds);

    waSocket.ev.on(
      "connection.update",
      ({ connection, lastDisconnect, qr }) => {
        if (qr) {
          socket.emit(
            "info",
            "A QR code was generated. Pairing display needs implementation."
          );
        }

        if (connection === "open") {
          waStarting = false;
          socket.emit("wa_connected");
          socket.emit("info", "WhatsApp connected.");
        }

        if (connection === "close") {
          socket.emit("info", "WhatsApp disconnected.");
          waSocket = null;
          waStarting = false;

          const statusCode =
            lastDisconnect?.error?.output?.statusCode;

          if (statusCode === 401) {
            socket.emit(
              "info",
              "WhatsApp session logged out."
            );
          }
        }
      }
    );
  } catch (error) {
    waSocket = null;
    waStarting = false;
    socket.emit(
      "info",
      `WhatsApp connection failed: ${error.message}`
    );
  }
}

io.on("connection", (socket) => {
  socket.emit("app_ready", {
    mode: "local-no-login",
    storage: "database.json",
    whatsappConnected: Boolean(waSocket?.user)
  });

  socket.on("connect_whatsapp", async () => {
    await startWhatsApp(socket);
  });

  socket.on("get_local_settings", () => {
    const db = readDatabase();

    socket.emit("local_settings", {
      licenseKeyCount: db.license_keys.length,
      storage: "database.json"
    });
  });
});

server.listen(PORT, HOST, () => {
  console.log(
    `Local dashboard running at http://${HOST}:${PORT}`
  );
  console.log("MongoDB and login are disabled.");
});
