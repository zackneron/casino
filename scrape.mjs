// Entry point: pick the first source that will have us, extract offers, structure them, write JSON.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import * as cheerio from "cheerio";

import { LLMError, structureOffers } from "./llm.mjs";
import { ScrapeError, SourceUnavailable, checkRobots, fetchHtml } from "./policy.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT = path.join(here, "docs", "bonuses.json");

// --- parsers ----------------------------------------------------------------

// "Top ten sign-up bonuses compared" table. Cells are kept as raw text.
export function parseCasinoOrg($, sourceUrl, limit) {
  const table = $("#bonus-compared table").first();
  if (!table.length) throw new SourceUnavailable("comparison table not found - layout changed");

  const headers = table.find("thead th").map((_, th) => $(th).text().trim()).get();
  const offers = [];
  table.find("tbody tr").each((_, row) => {
    const cells = $(row).find("td").map((__, td) => $(td).text().replace(/\s+/g, " ").trim()).get();
    if (cells.length < headers.length || offers.length >= limit) return;
    const record = Object.fromEntries(headers.map((h, i) => [h, cells[i]]));
    const casino = (record["Casino"] ?? "").trim();
    if (!casino) return;
    offers.push({
      casino,
      sourceUrl,
      rawTerms: {
        bonus: record["Sign-up bonus*"] ?? "",
        min_deposit: record["Min. deposit"] ?? "",
        wagering: record["Wagering requirements"] ?? "",
      },
    });
  });
  return offers;
}

const HEADING_RE = /^#\d+\s*[—\-–]\s*.+?:\s*(.+)$/;

// Editorial cards headed "#1 — Best Overall Casino Bonus: JacksPay Casino". No table, just prose:
// the first paragraph is the headline, the rest is copy that may or may not state wagering/deposit.
export function parseVegasSlotsOnline($, sourceUrl, limit) {
  const offers = [];
  $("h3").each((_, h3) => {
    if (offers.length >= limit) return;
    const match = $(h3).text().replace(/\s+/g, " ").trim().match(HEADING_RE);
    if (!match) return;
    const paragraphs = $(h3)
      .closest("div")
      .find("p")
      .map((__, p) => $(p).text().replace(/\s+/g, " ").trim())
      .get()
      .filter(Boolean);
    if (!paragraphs.length) return;
    offers.push({
      casino: match[1].trim(),
      sourceUrl,
      rawTerms: {
        headline: paragraphs[0].replace(/^Bonus:\s*/, ""),
        details: paragraphs.slice(1).join(" "),
      },
    });
  });
  return offers;
}

export const SOURCES = [
  { name: "Casino.org", url: "https://www.casino.org/bonus/", parse: parseCasinoOrg },
  { name: "VegasSlotsOnline", url: "https://www.vegasslotsonline.com/casino-bonuses/", parse: parseVegasSlotsOnline },
];

// --- source selection -------------------------------------------------------

// Walk the list, skipping any source that blocks us, and return the first that works.
export async function collectOffers(sources, limit, { fetchImpl = fetch, sleep, log = console.error } = {}) {
  const failures = [];
  for (const source of sources) {
    try {
      await checkRobots(source.url, fetchImpl, sleep);
      const $ = cheerio.load(await fetchHtml(source.url, fetchImpl));
      const offers = source.parse($, source.url, limit);
      if (offers.length < limit) throw new SourceUnavailable(`only parsed ${offers.length} of ${limit} offers`);
      log(`using ${source.name} (${source.url})`);
      return { source, offers };
    } catch (err) {
      if (!(err instanceof SourceUnavailable)) throw err;
      log(`skipping ${source.name}: ${err.message}`);
      failures.push(`${source.name}: ${err.message}`);
    }
  }
  throw new ScrapeError(`every source was unusable:\n  ${failures.join("\n  ")}`);
}

// --- output -----------------------------------------------------------------

export function buildDocument(source, offers, structured, method, model) {
  return {
    source: { name: source.name, url: source.url, scraped_at: new Date().toISOString().replace(/\.\d+Z$/, "Z") },
    extraction: { method, model },
    casinos: offers.map((raw, i) => ({
      casino: raw.casino,
      welcome_bonus: structured[i].welcome_bonus,
      wagering_requirement: structured[i].wagering_requirement,
      min_deposit: structured[i].min_deposit,
      min_deposit_amount: structured[i].min_deposit_amount,
      min_deposit_currency: structured[i].min_deposit_currency,
      source_url: raw.sourceUrl,
      raw_terms: raw.rawTerms,
    })),
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      limit: { type: "string", default: "3" },
      out: { type: "string", default: DEFAULT_OUTPUT },
      source: { type: "string" },
      "no-llm": { type: "boolean", default: false },
    },
  });

  const limit = Number.parseInt(values.limit, 10);
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) {
    console.error("error: --limit must be an integer from 1 to 10");
    return 1;
  }
  const sources = values.source ? SOURCES.filter((s) => s.name === values.source) : SOURCES;
  if (!sources.length) {
    console.error(`error: unknown --source. Choose one of: ${SOURCES.map((s) => s.name).join(", ")}`);
    return 1;
  }

  try {
    const { source, offers } = await collectOffers(sources, limit);
    const { fields, method, model } = await structureOffers(offers, { useLlm: !values["no-llm"] });
    const document = buildDocument(source, offers, fields, method, model);

    await mkdir(path.dirname(values.out), { recursive: true });
    await writeFile(values.out, `${JSON.stringify(document, null, 2)}\n`, "utf8");

    console.log(`wrote ${document.casinos.length} casinos to ${values.out} (extraction: ${method}/${model})`);
    for (const row of document.casinos) {
      const wagering = row.wagering_requirement ? `${row.wagering_requirement}x` : "n/a";
      console.log(`  ${row.casino}: ${row.welcome_bonus} | ${wagering} | min ${row.min_deposit}`);
    }
    return 0;
  } catch (err) {
    if (err instanceof ScrapeError || err instanceof LLMError) {
      console.error(`error: ${err.message}`);
      return 1;
    }
    throw err;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
