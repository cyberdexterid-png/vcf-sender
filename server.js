const express = require("express");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 3000);

// Bind to localhost by default: this is a private, single-user local utility.
const HOST = process.env.HOST || "127.0.0.1";

app.disable("x-powered-by");
app.use(express.static(path.join(__dirname, "public"), {
  dotfiles: "deny",
  index: "index.html",
  etag: true,
  maxAge: "1h"
}));

app.get("/health", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({
    ok: true,
    app: "XHYPER VCF SENDER V2",
    mode: "local-only",
    database: false,
    login: false
  });
});

app.listen(PORT, HOST, () => {
  console.log("XHYPER VCF SENDER V2 running at http://" + HOST + ":" + PORT);
  console.log("Local-only mode: no database, no login, no contact uploads.");
});
