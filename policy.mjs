// Crawl policy: robots.txt, blocks, CAPTCHAs and login walls end a source, they are never worked around.
import robotsParser from "robots-parser";

export const USER_AGENT_TOKEN = "casino-bonus-scraper";
export const USER_AGENT = `${USER_AGENT_TOKEN}/1.0 (+screening task; contact: scraper@example.com)`;
export const REQUEST_TIMEOUT_MS = 30_000;
export const MAX_BYTES = 8 * 1024 * 1024;

// Statuses that mean "you are being refused". No retry, no identity change.
export const BLOCKING_STATUSES = new Set([401, 402, 403, 407, 429, 451]);

const CHALLENGE_MARKERS = [
  "cdn-cgi/challenge-platform",
  "just a moment...",
  "checking your browser before accessing",
  "enable javascript and cookies to continue",
  "www.google.com/recaptcha/api.js",
  "g-recaptcha",
  "hcaptcha.com/1/api.js",
  "h-captcha",
  "/_incapsula_resource",
  "px-captcha",
  "please verify you are a human",
  "unusual traffic from your computer network",
  "ddos protection by",
];

// A page that wants credentials is not public data.
const LOGIN_MARKERS = ['type="password"', "sign in to continue", "log in to view", "members only"];

export class SourceUnavailable extends Error {}
export class ScrapeError extends Error {}

export function detectBlock(html) {
  // Challenges arrive with HTTP 200, so the body has to be checked as well as the status.
  const head = html.slice(0, 200_000).toLowerCase();
  for (const marker of CHALLENGE_MARKERS) {
    if (head.includes(marker)) return `bot challenge detected (${JSON.stringify(marker)})`;
  }
  for (const marker of LOGIN_MARKERS) {
    if (head.includes(marker)) return `login wall detected (${JSON.stringify(marker)})`;
  }
  return null;
}

function request(url, fetchImpl) {
  return fetchImpl(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html,text/plain" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch((err) => {
    throw new SourceUnavailable(`network failure: ${err.message}`);
  });
}

export async function checkRobots(url, fetchImpl = fetch, sleep = defaultSleep) {
  const robotsUrl = new URL("/robots.txt", url).href;
  const resp = await request(robotsUrl, fetchImpl);

  // No usable robots.txt: be conservative rather than assume permission.
  if (resp.status >= 400) {
    throw new SourceUnavailable(`robots.txt returned HTTP ${resp.status} - refusing to guess`);
  }

  const robots = robotsParser(robotsUrl, await resp.text());
  if (robots.isAllowed(url, USER_AGENT_TOKEN) === false) {
    throw new SourceUnavailable(`robots.txt disallows ${url}`);
  }

  const delay = robots.getCrawlDelay(USER_AGENT_TOKEN);
  if (delay) await sleep(delay * 1000);
}

export async function fetchHtml(url, fetchImpl = fetch) {
  if (new URL(url).protocol !== "https:") {
    throw new SourceUnavailable(`refusing to fetch non-https url: ${url}`);
  }

  const resp = await request(url, fetchImpl);
  if (BLOCKING_STATUSES.has(resp.status)) {
    throw new SourceUnavailable(`HTTP ${resp.status} - source is refusing us`);
  }
  if (resp.status >= 400) throw new SourceUnavailable(`HTTP ${resp.status}`);

  const body = Buffer.from(await resp.arrayBuffer());
  if (body.length > MAX_BYTES) throw new SourceUnavailable("response exceeded size cap");
  const html = body.toString("utf8");

  const reason = detectBlock(html);
  if (reason) throw new SourceUnavailable(reason);
  return html;
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
