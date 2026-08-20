#!/usr/bin/env node
/* Route integrity check + _redirects generator for dailyk9.com.
 *
 * Why this exists: twice in one day a derived artifact was frozen at a moment
 * while the source moved on. _redirects was generated before /about-nicole and
 * /contact existed, so both shipped serving 200 at BOTH /x and /x.html — the
 * exact duplicate-URL problem those rules exist to prevent. And contact.html was
 * built from a Block A snapshot taken before Person.url was added, so it shipped
 * one node stale. Neither showed up in a green summary; both needed every route
 * checked. This script is that check, so it stops depending on remembering.
 *
 *   node tools/check-routes.js            verify only, exit 1 on failure
 *   node tools/check-routes.js --fix      regenerate _redirects from the real route list
 *   node tools/check-routes.js --live     also check the deployed site over the network
 *
 * Run it as the last step of every task.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const ORIGIN = "https://dailyk9.com";
const BEGIN = "# === BEGIN GENERATED (tools/check-routes.js --fix) — do not hand-edit ===";
const END = "# === END GENERATED ===";

const argv = process.argv.slice(2);
const FIX = argv.includes("--fix");
const LIVE = argv.includes("--live");

const routes = fs.readdirSync(ROOT).filter(f => f.endsWith(".html")).sort();
const slugOf = f => (f === "index.html" ? "/" : "/" + f.replace(/\.html$/, ""));

const failures = [];
const fail = (route, msg) => failures.push({ route, msg });

/* Deliberate exceptions. Anything listed here is a decision, not a gap — if you
 * add to this list, say why, so the next person does not "fix" it back.
 * Post-submission thank-you pages: noindex, nofollow, no inbound links, reached
 * only by a form redirect. A canonical on a page no crawler should reach is
 * noise, and metadata on a page that never surfaces is dead weight. */
const NO_CANONICAL = new Set(["/records-received", "/review-thanks"]);

// ---------------------------------------------------------------- _redirects
function generateRedirects() {
  const pad = (s, n) => s + " ".repeat(Math.max(1, n - s.length));
  let out = BEGIN + "\n";
  out += "# Netlify serves every route at BOTH /x and /x.html with a 200. The trailing\n";
  out += '# "!" is REQUIRED: Netlify ignores a redirect whose source matches a real file\n';
  out += "# unless it is forced. Forcing does not re-enter the clean-URL resolver, so /x\n";
  out += "# still serves 200 with zero hops.\n";
  out += pad("/index.html", 33) + pad("/", 30) + "301!\n";
  for (const f of routes) {
    if (f === "index.html") continue;
    const s = slugOf(f);
    out += pad(s + ".html", 33) + pad(s, 30) + "301!\n";
  }
  out += "\n# Internal tooling must never be served or indexed.\n";
  out += pad("/tools/*", 33) + pad("/", 30) + "404!\n";
  out += END + "\n";
  return out;
}

function checkRedirects() {
  const p = path.join(ROOT, "_redirects");
  const cur = fs.readFileSync(p, "utf8");
  const want = generateRedirects();
  const has = cur.includes(BEGIN) && cur.includes(END);
  const block = has ? cur.slice(cur.indexOf(BEGIN), cur.indexOf(END) + END.length + 1) : null;

  if (FIX) {
    const next = has
      ? cur.slice(0, cur.indexOf(BEGIN)) + want + cur.slice(cur.indexOf(END) + END.length + 1)
      : cur.trimEnd() + "\n\n" + want;
    if (next !== cur) { fs.writeFileSync(p, next); console.log("  _redirects: regenerated from " + routes.length + " routes"); }
    else console.log("  _redirects: already current (" + routes.length + " routes)");
    return;
  }
  if (!has) { fail("_redirects", "no generated block — run with --fix"); return; }
  if (block !== want) {
    // name the specific routes whose rule is missing, rather than "file differs"
    for (const f of routes) {
      const s = slugOf(f);
      const rule = (f === "index.html" ? "/index.html" : s + ".html");
      if (!new RegExp("^\\" + rule.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s", "m").test(block))
        fail(s, "no .html -> clean-URL redirect rule (page is newer than _redirects)");
    }
    if (!/^\/tools\/\*/m.test(block)) fail("/tools/*", "tooling is publicly served — missing 404 rule");
    if (!failures.length) fail("_redirects", "generated block is stale — run with --fix");
  }
}

// ------------------------------------------------------------------- per-route
function checkRoutes() {
  const sitemap = fs.readFileSync(path.join(ROOT, "sitemap.xml"), "utf8");
  const rows = [];
  for (const f of routes) {
    const s = slugOf(f);
    const html = fs.readFileSync(path.join(ROOT, f), "utf8");

    const canonical = (html.match(/rel="canonical" href="([^"]*)"/) || [])[1] || null;
    const robots = (html.match(/name="robots" content="([^"]*)"/) || [])[1] || "index,follow";
    const noindex = /noindex/i.test(robots);
    const inSitemap = sitemap.includes("<loc>" + ORIGIN + (s === "/" ? "/" : s) + "</loc>");
    const blockA = html.includes('"@id": "' + ORIGIN + '/#business"');
    const nicole = html.includes('"@id": "' + ORIGIN + '/#nicole"');
    const website = html.includes('"@id": "' + ORIGIN + '/#website"');
    const personUrl = html.includes('"url": "' + ORIGIN + '/about-nicole"');

    if (!blockA) fail(s, "Block A missing (#business not defined)");
    if (!nicole) fail(s, "#nicole does not resolve on this route");
    if (!website) fail(s, "#website does not resolve on this route");
    if (!personUrl) fail(s, "Person.url missing — stale Block A copy?");
    if (!canonical) {
      if (!NO_CANONICAL.has(s)) fail(s, "no canonical");
    } else if (NO_CANONICAL.has(s)) {
      fail(s, "has a canonical but is on the NO_CANONICAL exception list — resolve the contradiction");
    } else if (canonical !== ORIGIN + (s === "/" ? "/" : s)) {
      fail(s, "canonical points at " + canonical + ", expected " + ORIGIN + s);
    }
    if (canonical && /\.html/.test(canonical)) fail(s, "canonical contains .html — builds a redirect hop into the page");
    if (!noindex && !inSitemap) fail(s, "indexable but not in sitemap");
    if (noindex && inSitemap) fail(s, "noindex but present in sitemap");

    rows.push({ route: s, sitemap: inSitemap, robots, canonical: !!canonical, blockA, personUrl });
  }

  // every ld+json block must parse, and no @id may be referenced without a definition
  const defs = new Set(), refs = new Map();
  let blocks = 0;
  for (const f of routes) {
    const html = fs.readFileSync(path.join(ROOT, f), "utf8");
    const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
    let m;
    while ((m = re.exec(html))) {
      blocks++;
      let j;
      try { j = JSON.parse(m[1]); }
      catch (e) { fail(slugOf(f), "ld+json parse failure: " + e.message); continue; }
      (function walk(n) {
        if (Array.isArray(n)) return n.forEach(walk);
        if (n && typeof n === "object") {
          const id = n["@id"];
          if (id) {
            // a node carrying only @id is a reference; anything more is a definition
            if (Object.keys(n).length > 1) defs.add(id);
            else if (!refs.has(id)) refs.set(id, slugOf(f));
          }
          Object.values(n).forEach(walk);
        }
      })(j);
    }
  }
  for (const [id, where] of refs) if (!defs.has(id)) fail(where, "dangling @id reference: " + id);

  return { rows, blocks };
}

// ----------------------------------------------------------------------- live
async function checkLive(rows) {
  console.log("\n  live checks against " + ORIGIN + " ...");
  const probe = async (url, expect) => {
    try {
      const r = await fetch(url, { redirect: "manual" });
      return r.status;
    } catch (e) { return "ERR:" + e.message; }
  };
  // Person.url must be a 200, not a 301 — otherwise the hop is inside the schema
  const st = await probe(ORIGIN + "/about-nicole");
  if (st !== 200) fail("/about-nicole", "Person.url target returns " + st + ", expected 200");
  for (const r of rows) {
    const dotHtml = r.route === "/" ? "/index.html" : r.route + ".html";
    const s1 = await probe(ORIGIN + dotHtml);
    if (s1 !== 301) fail(r.route, dotHtml + " returns " + s1 + ", expected 301 (duplicate URL is live)");
    const s2 = await probe(ORIGIN + r.route);
    if (s2 !== 200) fail(r.route, "clean URL returns " + s2 + ", expected 200");
  }
}

// ----------------------------------------------------------------------- main
(async () => {
  console.log("route integrity check — " + routes.length + " routes found in " + ROOT);
  checkRedirects();
  const { rows, blocks } = checkRoutes();
  console.log("  checked: " + rows.length + " routes, " + blocks + " ld+json blocks");
  console.log("  indexable: " + rows.filter(r => !/noindex/i.test(r.robots)).length +
              "   noindex: " + rows.filter(r => /noindex/i.test(r.robots)).length +
              "   in sitemap: " + rows.filter(r => r.sitemap).length);
  if (LIVE) await checkLive(rows);

  if (failures.length) {
    console.error("\nFAILED — " + failures.length + " problem(s) across " + routes.length + " routes checked:");
    for (const f of failures) console.error("  " + f.route.padEnd(48) + f.msg);
    process.exit(1);
  }
  console.log("\nOK — all " + routes.length + " routes pass" + (LIVE ? " (including live)" : "") + ".");
})();
