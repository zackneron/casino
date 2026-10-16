# Written part

## Taking this to production: 200 casinos, updated daily

**Where it runs**. I would use one small VPS and not a big cloud setup. 200 casinos once a day is a few minutes of work, and I can manage one server myself. I would consider Elitehost or Afrihost, both South African hosts, or AWS. Eliehost is much cheaper and I use it regularly.

**Database and backups**. I would use Postgres on the same server, because I know SQL and a spreadsheet won't hold 200 casinos with history. Backups would be a nightly pg_dump copied to a separate cloud bucket, kept for 30 days. Once or twice a month I would restore a backup onto my laptop to check it really works.

**Domain, DNS and HTTPS**. I would register a .co.za or any domain at Elitehost, Afrihost, Xneelo or domains.co.za, for about R100–R150 a year, DNS I would point the nameservers at Cloudflare's free plan and for HTTPS, Caddy gets and renews a free Let's Encrypt certificate by itself, so I would not manage certificates by hand.

**Scheduling and knowing it failed**. I would set a cron job runs npm run scrape at 03:00 SA time. For alert failure, I would use Healthchecks.io, which is free. The scraper pings it when it finishes, and if no ping arrives I get an email or a WhatsApp message, if a site returns 403 or shows a CAPTCHA, the scraper skips it and alerts me.

**Rough monthly cost**. Hosting range at R300–R500, Backup storage range at R50, domain (R120 a year ÷ 12),  Cloudflare, Healthchecks (free tiers), Language model calls (only for changed casinos) at R30–R60. Total maximum around R730.

---

## Five lines on AI

1. Tool: GitHub Copilot in VS Code (Claude Sonnet 5.5), used for source discovery, the
   scraper, the page, and this write-up.
2. It confidently proposed casino.guru and askgamblers.com as sources; both returned
   `403` to a plain request. Caught by curling the URLs and their robots.txt *before*
   writing any parser, which is also why the final scraper fails loudly on 403 instead
   of retrying with a fake User-Agent.
3. Its next suggestion, a VegasSlotsOnline editorial page, parsed cleanly but only ever
   contained the bonus headline — wagering and minimum deposit were rendered client-side.
   Caught by dumping the extracted text and seeing two of four fields come back null.
4. The first draft of the regex fallback appended currency codes to the wrong number,
   turning `$22,500 + 500 FS` into `22,500 + 500 USD free spins`. Caught on review and
   rewritten to substitute at the symbol.
5. Net: the code it writes is fine; the assumptions it makes about *other people's
   websites* are where it goes wrong, so every source claim got verified by hand.

## Time taken

About 2 hours 15 minutes end to end, most of it on source selection rather than code.

## What is missing

- **The live URL.** The page is built and verified locally but not yet deployed; push the
  repo and enable GitHub Pages on `main` / `/docs`.
- **`docs/bonuses.json` was generated with `--no-llm`.** No API key was available in this
  environment. Set `OPENAI_API_KEY` and run `npm run scrape` to regenerate it through the model;
  the structure is identical and `extraction.method` flips from `regex-fallback` to `llm`.
  The model path itself is covered by `test_llm.py` against a stubbed endpoint.
- **One market.** casino.org localises the table by request IP, so a run from a different
  country can return different currencies. Production would pin a market per run. The
  VegasSlotsOnline fallback is wired up and tested, but only exercised when casino.org
  refuses us, so it gets far less real-world mileage.
- None of the production design above is built — it is a plan, not running infrastructure.
