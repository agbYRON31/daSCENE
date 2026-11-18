// Local preview of the web version with the stock lookup: serves dist/web and runs api/stock.mjs
// the way Vercel would. node WealthDesk/web/dev-server.mjs [port]   (build first: web/build.sh)
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import handler from "../../api/stock.mjs";

const here = dirname(fileURLToPath(import.meta.url)), site = join(here, "..", "dist", "web");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };
const port = Number(process.argv[2] || process.env.PORT || 8766);
createServer(async (req, res) => {
  // Without SEC_CONTACT the SEC's ticker list can't be fetched; locally, fall back to the companies
  // in the test fixtures so lookups can still be tried end to end.
  if (req.url.startsWith("/api/stock?list=tickers") && !process.env.SEC_CONTACT) {
    const dir = join(here, "..", "Tests", "stock_fixtures"), m = {};
    for (const f of await readdir(dir)) {
      const fx = JSON.parse(await readFile(join(dir, f), "utf8"));
      m[fx.symbol] = [Number(fx.subs.cik), fx.subs.name];
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(m));
  }
  if (req.url.startsWith("/api/stock")) return handler(req, res);
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
  try {
    const body = await readFile(join(site, path.endsWith("/") ? path + "index.html" : path));
    res.writeHead(200, { "Content-Type": types[extname(path) || ".html"] || "application/octet-stream" });
    res.end(body);
  } catch { res.writeHead(404); res.end("Not found"); }
}).listen(port, () => console.log(`Wealth Desk web with stock lookup: http://localhost:${port}`));
