const express = require("express");
const path = require("path");
const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
app.disable("x-powered-by");
app.use(express.static(path.join(__dirname, "public"), { dotfiles: "deny", index: "index.html", etag: true, maxAge: "1h" }));
app.get("/health", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ ok: true, app: "XHYPER VCF SENDER V2", mode: "local-manual-whatsapp-handoff", apiRequired: false });
});
app.listen(PORT, HOST, () => console.log(`XHYPER VCF SENDER V2 running at http://${HOST}:${PORT}`));
