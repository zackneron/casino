const DATA_URL = "bonuses.json";

// Textual cue as well as colour, so the badge is not colour-only.
function wageringClass(multiplier) {
  if (multiplier == null) return "wagering-none";
  if (multiplier <= 20) return "wagering-low";
  if (multiplier <= 35) return "wagering-mid";
  return "wagering-high";
}

function el(tag, { className, text, attrs } = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  // textContent, never innerHTML: scraped values are untrusted.
  if (text != null) node.textContent = text;
  for (const [name, value] of Object.entries(attrs ?? {})) node.setAttribute(name, value);
  return node;
}

function cell(label, className) {
  const td = el("td", { className, attrs: { "data-label": label } });
  return td;
}

function safeHttpsUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("non-https source url");
  return url;
}

function renderRow(row) {
  const tr = el("tr");

  const name = cell("Casino", "casino-name");
  name.textContent = row.casino;

  const bonus = cell("Welcome bonus", "bonus");
  bonus.textContent = row.welcome_bonus ?? "—";

  const wagering = cell("Wagering");
  const hasWagering = row.wagering_requirement != null;
  wagering.append(
    el("span", {
      className: `badge wagering-badge ${wageringClass(row.wagering_requirement)}`,
      text: hasWagering ? `${row.wagering_requirement}\u00d7` : "n/a",
    }),
  );

  const deposit = cell("Min. deposit");
  deposit.textContent = row.min_deposit ?? "—";

  const source = cell("Source");
  const url = safeHttpsUrl(row.source_url);
  const link = el("a", {
    className: "btn btn-sm btn-outline-primary",
    text: url.hostname.replace(/^www\./, ""),
    attrs: { href: url.href, target: "_blank", rel: "nofollow noopener noreferrer" },
  });
  source.append(link);

  tr.append(name, bonus, wagering, deposit, source);
  return tr;
}

function renderTable(data) {
  const table = el("table", { className: "table table-hover align-middle offers-table" });

  const headRow = table.createTHead().insertRow();
  for (const label of ["Casino", "Welcome bonus", "Wagering", "Min. deposit", "Source"]) {
    headRow.append(el("th", { text: label, attrs: { scope: "col" } }));
  }

  const body = table.createTBody();
  for (const row of data.casinos) body.append(renderRow(row));
  return table;
}

function renderMeta(data) {
  const scraped = new Date(data.source.scraped_at).toLocaleString();
  return (
    `${data.casinos.length} casinos from ${data.source.name} \u00b7 scraped ${scraped} ` +
    `\u00b7 fields extracted via ${data.extraction.method}` +
    (data.extraction.model === "none" ? "" : ` (${data.extraction.model})`)
  );
}

function showError(message) {
  const alert = el("div", { className: "alert alert-danger m-3", text: message, attrs: { role: "alert" } });
  document.getElementById("table-wrap").replaceChildren(alert);
}

async function main() {
  const wrap = document.getElementById("table-wrap");
  try {
    const resp = await fetch(DATA_URL, { cache: "no-cache" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();

    wrap.replaceChildren(renderTable(data));
    document.getElementById("meta").textContent = renderMeta(data);
  } catch (err) {
    showError(
      `Could not load ${DATA_URL}: ${err.message}. ` +
        "If you opened this file directly, serve the folder instead (npx serve docs).",
    );
  }
}

main();
