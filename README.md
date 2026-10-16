# Casino bonus scraper

Pulls welcome-bonus terms for 3 online casinos from one public source, normalises the
free-text terms into structured fields with a language model, writes a JSON file, and
renders that JSON as a mobile-readable table. Plain Node.js, no build step.

**Live page:** <!-- replace after deploying, e.g. https://<user>.github.io/casino/ -->

| Field | Example |
| --- | --- |
| Welcome bonus | `100% up to 777 USD + 100 free spins` |
| Wagering requirement (multiplier) | `40` |
| Minimum deposit | `30 USD` |
| Source URL | `https://www.casino.org/bonus/` |

## Install and run

Requires Node.js 22.9 or newer.

```bash
npm install
cp .env.example .env     # put your API key in .env (gitignored)
npm run scrape
```

Output goes to [docs/bonuses.json](docs/bonuses.json).

```bash
npm run scrape -- --limit 5                # pull more casinos (1-10)
npm run scrape -- --out /tmp/bonuses.json  # different output path
npm run scrape -- --source Casino.org      # pin one source instead of trying in order
npm run scrape -- --no-llm                 # deterministic regex fallback, no API key needed
```

## Sources and crawl policy

The scraper holds an ordered list of sources and uses the first one that will have it:

| # | Source | Shape |
| --- | --- | --- |
| 1 | [`casino.org/bonus/`](https://www.casino.org/bonus/) | "Top ten sign-up bonuses compared" table |
| 2 | [`vegasslotsonline.com/casino-bonuses/`](https://www.vegasslotsonline.com/casino-bonuses/) | editorial offer cards, free prose |

Both are server-rendered, so no headless browser is needed.

**robots.txt.** Before any other request to a host, `robots.txt` is fetched and evaluated
(`robots-parser`) for this scraper's User-Agent. A disallowed path, or a `robots.txt` that
cannot be read, drops the source before its page is ever requested — permission is never
assumed. Any `Crawl-delay` is honoured.

**Blocks are respected, not bypassed.** A source is abandoned, and the next one tried,
when it:

- returns `401`, `402`, `403`, `407`, `429` or `451` — one attempt, no retry, no
  User-Agent rotation, no proxy;
- serves a bot challenge instead of content: Cloudflare (`cdn-cgi/challenge-platform`,
  "Just a moment…"), reCAPTCHA, hCaptcha, Incapsula or PerimeterX. These usually arrive
  with HTTP 200, so the body is checked as well as the status;
- serves a login wall (a password input, "sign in to continue", "members only").

No CAPTCHA is ever solved or skipped and no credentials are sent anywhere. If every
source refuses, the run exits non-zero with the reason for each rather than producing
data. casino.guru and askgamblers.com are not in the list because both answered a plain
request with `403` — they were dropped rather than worked around.

Logic lives in [policy.mjs](policy.mjs).

## The language model step

Scraping only yields raw terms: tidy cells such as `🥇 Up to $22,500 + 500 FS`, `$30` and
`40x bonus, 40x free spins` from casino.org, or a paragraph of prose from
VegasSlotsOnline. The model turns either shape into the structured fields: a clean bonus
string with ISO currency codes, an integer wagering multiplier, and a numeric minimum
deposit plus its currency. Values the page does not state come back `null` rather than
guessed.

Any OpenAI-compatible Chat Completions endpoint works:

| Variable | Default | Notes |
| --- | --- | --- |
| `OPENAI_API_KEY` | — | required unless `--no-llm` |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | OpenRouter, Groq, Ollama, … |
| `OPENAI_MODEL` | `gpt-4o-mini` | |

`extraction.method` in the JSON records whether a run used `llm` or `regex-fallback`.

## Viewing and styling the page

The page is static: [docs/index.html](docs/index.html) loads
[docs/assets/main.css](docs/assets/main.css) and [docs/assets/app.js](docs/assets/app.js),
and `app.js` fetches `bonuses.json`, so serve the folder rather than opening it from disk:

```bash
npx serve docs
```

Styling is Bootstrap 5 plus a small amount of SCSS in [src/scss](src/scss). Only the
Bootstrap parts the page uses are imported, which keeps the compiled CSS around 55 KB.
`docs/assets/main.css` is committed so GitHub Pages can serve `docs/` as-is; rebuild it
after editing any SCSS:

```bash
npm run build:css   # one-off, compressed
npm run watch:css   # rebuild on save
```

The stylesheet carries no secrets and runs no scraped markup: every scraped value is
written with `textContent`.

The `docs/` folder is laid out for GitHub Pages (*Settings → Pages → Deploy from branch
→ `main` / `/docs`*); Netlify or Vercel work with `docs` as the publish directory and no
build command.

## Tests

```bash
npm test
```

33 tests on Node's built-in runner, covering the two things that can quietly produce bad
output: the crawl policy (robots allow/disallow, unreadable robots, crawl-delay, 403/429,
CAPTCHA bodies served with HTTP 200, login walls, switching to the next source,
all-sources-blocked) and the model-output validation (rejected renames, implausible
multipliers, wrong row counts, nulls, untrusted-data wrapping).

## Security notes

- The API key is read from the environment only; `.env` is gitignored and `.env.example`
  holds no real value.
- Scraped text is untrusted. It is length-capped and passed to the model inside
  `<untrusted_data>` delimiters, with a system prompt that forbids following
  instructions found in it — a scraped page could otherwise attempt prompt injection.
- The model's reply never reaches the output unchecked: every field is whitelisted,
  type-checked and range-checked, and the casino name must match the scraped row.
- The page renders every scraped value with `textContent`, never `innerHTML`, and
  validates `source_url` is `https:` before building a link, so no scraped string can
  execute as markup.
- Fetching is `https`-only, with a timeout and a response size cap.

## Files

```
scrape.mjs         entry point, source list, table + prose parsers, output
policy.mjs         robots.txt, block / CAPTCHA / login-wall detection, safe fetch
llm.mjs            free text -> structured fields, validation, regex fallback
test/*.test.mjs    node:test suites
src/scss/          SCSS source (Bootstrap overrides + page styles)
docs/index.html    the published page
docs/assets/       compiled main.css and app.js
docs/bonuses.json  scraper output
WRITEUP.md         production notes, AI notes, time taken
```
