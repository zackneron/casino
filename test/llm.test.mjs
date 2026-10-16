import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LLMError, regexFields, structureOffers } from "../llm.mjs";

const OFFERS = [
  {
    casino: "RetroBet",
    sourceUrl: "https://www.casino.org/bonus/",
    rawTerms: { bonus: "🥇 Up to $22,500 + 500 FS", min_deposit: "$30", wagering: "40x bonus, 40x free spins" },
  },
];

const env = { OPENAI_API_KEY: "test-key" };
const replying = (offers) => async () =>
  new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ offers }) } }] }));
const good = {
  casino: "RetroBet",
  welcome_bonus: "Up to 22,500 USD + 500 free spins",
  wagering_requirement: 40,
  min_deposit_amount: 30,
  min_deposit_currency: "usd",
};
const run = (modelOffers) => structureOffers(OFFERS, { env, fetchImpl: replying(modelOffers) });

describe("model output validation", () => {
  it("accepts a good response and normalises currency case", async () => {
    const { fields, method } = await run([good]);
    assert.equal(method, "llm");
    assert.equal(fields[0].wagering_requirement, 40);
    assert.equal(fields[0].min_deposit, "30 USD");
  });

  it("rejects a renamed casino", async () => {
    await assert.rejects(run([{ ...good, casino: "Totally Other Casino" }]), LLMError);
  });

  it("rejects an implausible wagering multiplier", async () => {
    await assert.rejects(run([{ ...good, wagering_requirement: 4000 }]), LLMError);
  });

  it("rejects a bad currency code", async () => {
    await assert.rejects(run([{ ...good, min_deposit_currency: "DROP TABLE" }]), LLMError);
  });

  it("rejects the wrong number of offers", async () => {
    await assert.rejects(run([]), LLMError);
  });

  it("keeps missing values as null and falls back to the raw cell", async () => {
    const { fields } = await run([{ ...good, wagering_requirement: null, min_deposit_amount: null, min_deposit_currency: null }]);
    assert.equal(fields[0].wagering_requirement, null);
    assert.equal(fields[0].min_deposit, "$30");
  });

  it("wraps scraped text as untrusted data and never sends the key in the body", async () => {
    let sent;
    const fetchImpl = async (_url, init) => {
      sent = init;
      return replying([good])();
    };
    await structureOffers(OFFERS, { env, fetchImpl });
    assert.match(JSON.parse(sent.body).messages[1].content, /^<untrusted_data>/);
    assert.ok(!sent.body.includes("test-key"));
  });

  it("fails clearly when no API key is set", async () => {
    await assert.rejects(structureOffers(OFFERS, { env: {} }), /OPENAI_API_KEY/);
  });
});

describe("regex fallback", () => {
  it("parses table cells", () => {
    assert.deepEqual(regexFields(OFFERS[0]), {
      casino: "RetroBet",
      welcome_bonus: "Up to 22,500 USD + 500 free spins",
      wagering_requirement: 40,
      min_deposit_amount: 30,
      min_deposit_currency: "USD",
    });
  });

  it("does not mistake the bonus cap for a minimum deposit in prose", () => {
    const fields = regexFields({
      casino: "JacksPay",
      rawTerms: { headline: "Get 200% Match Bonus up to $6,000", details: "A big welcome offer." },
    });
    assert.equal(fields.min_deposit_amount, null);
    assert.equal(fields.welcome_bonus, "Get 200% Match Bonus up to 6,000 USD");
  });

  it("reads a labelled minimum deposit and wagering from prose", () => {
    const fields = regexFields({
      casino: "X",
      rawTerms: { headline: "100% up to $500", details: "Minimum deposit $20 with 35x wagering." },
    });
    assert.equal(fields.min_deposit_amount, 20);
    assert.equal(fields.wagering_requirement, 35);
  });
});
