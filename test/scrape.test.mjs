import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as cheerio from "cheerio";

import { ScrapeError, SourceUnavailable } from "../policy.mjs";
import { collectOffers, parseCasinoOrg, parseVegasSlotsOnline } from "../scrape.mjs";

const CLEAN = "<html><body><p>ok</p></body></html>";

const offer = (casino, sourceUrl) => ({ casino, sourceUrl, rawTerms: { bonus: "100% up to $100" } });

// Robots allows everything; each host answers with a canned page or status.
function hostFetch(pages) {
  return async (url) => {
    const { hostname, pathname } = new URL(url);
    if (pathname === "/robots.txt") return new Response("User-agent: *\nAllow: /\n");
    const page = pages[hostname];
    return new Response(page.body ?? CLEAN, { status: page.status ?? 200 });
  };
}

const working = {
  name: "Working",
  url: "https://working.example/bonus/",
  parse: (_$, url, limit) => Array.from({ length: limit }, (_, i) => offer(`C${i}`, url)),
};
const blocked = { name: "Blocked", url: "https://blocked.example/bonus/", parse: () => [] };
const quiet = { log: () => {} };

describe("source switching", () => {
  it("moves past a source that answers 403", async () => {
    const fetchImpl = hostFetch({ "blocked.example": { status: 403 }, "working.example": {} });
    const { source, offers } = await collectOffers([blocked, working], 3, { fetchImpl, ...quiet });
    assert.equal(source.name, "Working");
    assert.equal(offers.length, 3);
  });

  it("moves past a source serving a CAPTCHA with HTTP 200", async () => {
    const captcha = '<script src="https://www.google.com/recaptcha/api.js"></script>';
    const fetchImpl = hostFetch({ "blocked.example": { body: captcha }, "working.example": {} });
    const { source } = await collectOffers([blocked, working], 3, { fetchImpl, ...quiet });
    assert.equal(source.name, "Working");
  });

  it("moves past a source whose robots.txt disallows it", async () => {
    const fetchImpl = async (url) => {
      const { hostname, pathname } = new URL(url);
      if (pathname === "/robots.txt") {
        return new Response(hostname === "blocked.example" ? "User-agent: *\nDisallow: /\n" : "User-agent: *\nAllow: /\n");
      }
      return new Response(CLEAN);
    };
    const { source } = await collectOffers([blocked, working], 3, { fetchImpl, ...quiet });
    assert.equal(source.name, "Working");
  });

  it("never fetches the page of a robots-disallowed source", async () => {
    const requested = [];
    const fetchImpl = async (url) => {
      requested.push(url);
      return new Response(new URL(url).pathname === "/robots.txt" ? "User-agent: *\nDisallow: /\n" : CLEAN);
    };
    await assert.rejects(collectOffers([blocked], 3, { fetchImpl, ...quiet }), ScrapeError);
    assert.deepEqual(requested, ["https://blocked.example/robots.txt"]);
  });

  it("falls through when a source parses too few offers", async () => {
    const thin = { name: "Thin", url: "https://thin.example/bonus/", parse: (_$, url) => [offer("C0", url)] };
    const fetchImpl = hostFetch({ "thin.example": {}, "working.example": {} });
    const { source } = await collectOffers([thin, working], 3, { fetchImpl, ...quiet });
    assert.equal(source.name, "Working");
  });

  it("is fatal when every source refuses", async () => {
    const fetchImpl = hostFetch({ "blocked.example": { status: 403 }, "working.example": { status: 429 } });
    await assert.rejects(collectOffers([blocked, working], 3, { fetchImpl, ...quiet }), (err) => {
      assert.ok(err instanceof ScrapeError);
      assert.match(err.message, /403/);
      assert.match(err.message, /429/);
      return true;
    });
  });
});

describe("parsers", () => {
  it("reads the casino.org comparison table", () => {
    const html = `<section id="bonus-compared"><table>
      <thead><tr><th>Casino</th><th>Sign-up bonus*</th><th>Min. deposit</th><th>Wagering requirements</th></tr></thead>
      <tbody><tr><td>RetroBet</td><td><strong>🥇 Up to $22,500 + 500 FS</strong></td><td>$30</td><td>40x bonus, 40x free spins</td></tr></tbody>
    </table></section>`;
    const [row] = parseCasinoOrg(cheerio.load(html), "https://x/", 3);
    assert.equal(row.casino, "RetroBet");
    assert.deepEqual(row.rawTerms, {
      bonus: "🥇 Up to $22,500 + 500 FS",
      min_deposit: "$30",
      wagering: "40x bonus, 40x free spins",
    });
  });

  it("flags a missing table as a layout change", () => {
    assert.throws(() => parseCasinoOrg(cheerio.load("<html></html>"), "https://x/", 3), SourceUnavailable);
  });

  it("reads a VegasSlotsOnline offer card", () => {
    const html = `<div><h3>#1 — Best Overall Casino Bonus: JacksPay Casino</h3>
      <p><strong>Bonus:</strong> Get 200% Match Bonus up to $6,000</p>
      <p>Minimum deposit $20, 35x wagering.</p></div>`;
    const [row] = parseVegasSlotsOnline(cheerio.load(html), "https://x/", 1);
    assert.equal(row.casino, "JacksPay Casino");
    assert.equal(row.rawTerms.headline, "Get 200% Match Bonus up to $6,000");
    assert.match(row.rawTerms.details, /35x wagering/);
  });
});
