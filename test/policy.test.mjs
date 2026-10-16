import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SourceUnavailable, checkRobots, detectBlock, fetchHtml } from "../policy.mjs";

const CLOUDFLARE = '<html><head><title>Just a moment...</title><script src="/cdn-cgi/challenge-platform/x"></script></head></html>';
const RECAPTCHA = '<html><body><script src="https://www.google.com/recaptcha/api.js"></script></body></html>';
const LOGIN_WALL = '<html><body><form><input name="pw" type="password"></form></body></html>';
const CLEAN = '<html><body><section id="bonus-compared"><p>hello</p></section></body></html>';

// Canned response per URL; records every request so tests can assert "exactly one attempt".
function fakeFetch(responses) {
  const requested = [];
  const impl = async (url) => {
    requested.push(url);
    const { status = 200, body = "" } = responses[url];
    return new Response(body, { status });
  };
  impl.requested = requested;
  return impl;
}

const rejectsUnavailable = (promise, pattern) =>
  assert.rejects(promise, (err) => err instanceof SourceUnavailable && (!pattern || pattern.test(err.message)));

describe("block detection", () => {
  it("flags a Cloudflare challenge", () => assert.match(detectBlock(CLOUDFLARE), /bot challenge/));
  it("flags reCAPTCHA", () => assert.match(detectBlock(RECAPTCHA), /bot challenge/));
  it("flags a login wall", () => assert.match(detectBlock(LOGIN_WALL), /login wall/));
  it("passes a clean page", () => assert.equal(detectBlock(CLEAN), null));
});

describe("fetchHtml", () => {
  const url = "https://example.com/bonus/";

  it("treats 403 as a block with exactly one attempt", async () => {
    const f = fakeFetch({ [url]: { status: 403, body: "nope" } });
    await rejectsUnavailable(fetchHtml(url, f), /403/);
    assert.deepEqual(f.requested, [url]);
  });

  it("treats 429 as a block", async () => {
    await rejectsUnavailable(fetchHtml(url, fakeFetch({ [url]: { status: 429 } })), /429/);
  });

  it("rejects a challenge page served with HTTP 200", async () => {
    await rejectsUnavailable(fetchHtml(url, fakeFetch({ [url]: { body: CLOUDFLARE } })), /bot challenge/);
  });

  it("refuses plain http", async () => {
    await rejectsUnavailable(fetchHtml("http://example.com/bonus/", fakeFetch({})), /non-https/);
  });

  it("returns clean html", async () => {
    assert.equal(await fetchHtml(url, fakeFetch({ [url]: { body: CLEAN } })), CLEAN);
  });
});

describe("checkRobots", () => {
  const robots = (body, status = 200) => fakeFetch({ "https://example.com/robots.txt": { status, body } });

  it("rejects a disallowed path", async () => {
    await rejectsUnavailable(
      checkRobots("https://example.com/bonus/", robots("User-agent: *\nDisallow: /bonus/\n")),
      /disallows/,
    );
  });

  it("allows a permitted path", async () => {
    await checkRobots("https://example.com/bonus/", robots("User-agent: *\nDisallow: /casinos/\n"));
  });

  it("does not assume permission when robots.txt is unreadable", async () => {
    await rejectsUnavailable(checkRobots("https://example.com/bonus/", robots("", 500)), /refusing to guess/);
  });

  it("honours Crawl-delay", async () => {
    const sleeps = [];
    await checkRobots("https://example.com/bonus/", robots("User-agent: *\nCrawl-delay: 2\n"), async (ms) => sleeps.push(ms));
    assert.deepEqual(sleeps, [2000]);
  });
});
