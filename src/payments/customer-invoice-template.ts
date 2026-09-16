export type CustomerInvoiceTemplateInput = {
  documentTitle: string;
  invoiceNumber: string;
  status: string;
  issuedAt: Date;
  seller: {
    name: string;
    oib: string;
    address?: string | null;
    email?: string | null;
  };
  brand?: {
    logoUrl?: string | null;
  };
  buyer: {
    name?: string | null;
    email?: string | null;
  };
  reservation: {
    venueName?: string | null;
    tableLabel?: string | null;
    serviceDate?: Date | null;
  };
  item: {
    description: string;
    amountCents: number;
    refundedCents: number;
    currency: string;
  };
  note?: string | null;
};

const formatterCache = new Map<string, Intl.NumberFormat>();

function escapeHtml(value?: string | null) {
  return (value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDate(value?: Date | null) {
  if (!value) {
    return "—";
  }
  return new Intl.DateTimeFormat("hr-HR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Zagreb",
  }).format(value);
}

function formatMoney(cents: number, currency: string) {
  const key = currency.trim().toUpperCase() || "EUR";
  let formatter = formatterCache.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat("hr-HR", {
      style: "currency",
      currency: key,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    formatterCache.set(key, formatter);
  }
  return formatter.format(cents / 100);
}

function statusLabel(status: string) {
  switch (status.trim().toUpperCase()) {
    case "REFUNDED":
      return "Račun storniran / povrat evidentiran";
    case "PARTIALLY_REFUNDED":
      return "Djelomični povrat evidentiran";
    case "VOIDED":
      return "Račun poništen";
    default:
      return "Izdano";
  }
}

function localizedTableLabel(value?: string | null) {
  const raw = value?.trim();
  if (!raw) {
    return "";
  }

  return raw
    .replace(/^table\s+/i, "Stol ")
    .replace(/^room\s+/i, "Prostorija ")
    .replace(/\btable\b/gi, "stol")
    .replace(/\broom\b/gi, "prostorija")
    .replace(/\bvip\b/gi, "VIP")
    .replace(/\s+/g, " ")
    .trim();
}

function tableTypeSuffix(value?: string | null) {
  const normalized = value?.trim().toUpperCase() ?? "";

  if (!normalized) {
    return "";
  }

  if (/\bVIP\b/.test(normalized)) {
    return "VIP";
  }
  if (/\bLARGE\b/.test(normalized) || /\bL\b/.test(normalized)) {
    return "L";
  }
  if (/\bSTANDARD\b/.test(normalized) || /\bS\b/.test(normalized)) {
    return "S";
  }

  return "";
}

function localizedTableLabelWithType(value?: string | null) {
  const tableLabel = localizedTableLabel(value);
  const suffix = tableTypeSuffix(value);

  if (!tableLabel) {
    return suffix ? `Stol ${suffix}` : "";
  }

  if (
    !suffix ||
    new RegExp(`\\b${suffix}\\b`, "i").test(tableLabel) ||
    (suffix === "VIP" && /\bVIP\b/i.test(tableLabel))
  ) {
    return tableLabel;
  }

  return `${tableLabel} ${suffix}`;
}

export function renderCustomerInvoiceHtml(input: CustomerInvoiceTemplateInput) {
  const grossLabel = formatMoney(input.item.amountCents, input.item.currency);
  const refundedLabel = formatMoney(
    input.item.refundedCents,
    input.item.currency,
  );
  const netCents = Math.max(
    0,
    input.item.amountCents - input.item.refundedCents,
  );
  const netLabel = formatMoney(netCents, input.item.currency);
  const hasRefund = input.item.refundedCents > 0;
  const tableLabel = localizedTableLabelWithType(input.reservation.tableLabel);
  const venueAndTableLabel =
    [input.reservation.venueName, tableLabel].filter(Boolean).join(" · ") ||
    "—";

  return `<!doctype html>
<html lang="hr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(input.documentTitle)} ${escapeHtml(input.invoiceNumber)}</title>
  <style>
    :root {
      color-scheme: light;
      --espresso: #2d1a10;
      --brown: #63391e;
      --muted: #8a5a2b;
      --cream: #fff7dc;
      --paper: #fffaf0;
      --gold: #ffc857;
      --orange: #ff7a1a;
      --border: #e3c883;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 0;
      background:
        radial-gradient(circle at 20% 0%, rgba(255, 247, 220, 0.48), transparent 32rem),
        linear-gradient(180deg, #ffd66b 0%, #ffa72a 48%, #ff7a1a 100%);
      color: var(--espresso);
      font-family: Inter, Arial, Helvetica, sans-serif;
      line-height: 1.35;
    }
    .page {
      width: 210mm;
      min-height: 297mm;
      margin: 0 auto;
      padding: 13mm 14mm;
      background: linear-gradient(180deg, #fffaf0 0%, #fff7dc 100%);
      border: 1px solid rgba(227, 200, 131, 0.9);
      border-radius: 0;
      box-shadow: none;
    }
    .brand {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 18px;
      padding-bottom: 16px;
      border-bottom: 2px solid rgba(214, 166, 46, 0.35);
    }
    .brand-title {
      margin: 0;
      font-size: 28px;
      font-weight: 900;
      letter-spacing: -0.04em;
    }
    .brand-lockup {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .brand-logo {
      width: 46px;
      height: 46px;
      object-fit: contain;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      padding: 7px 12px;
      border-radius: 999px;
      background: rgba(255, 117, 31, 0.12);
      color: var(--brown);
      border: 1px solid rgba(255, 117, 31, 0.32);
      font-size: 11px;
      font-weight: 900;
      white-space: nowrap;
    }
    .invoice-head {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      margin-top: 18px;
    }
    .card {
      padding: 13px 14px;
      background: rgba(255, 252, 245, 0.82);
      border: 1px solid rgba(227, 200, 131, 0.72);
      border-radius: 14px;
    }
    .label {
      margin: 0 0 4px;
      color: var(--muted);
      font-size: 10px;
      font-weight: 900;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }
    .value {
      margin: 0;
      color: var(--espresso);
      font-size: 12px;
      font-weight: 800;
    }
    .value + .label { margin-top: 9px; }
    .title-block { margin: 18px 0 14px; }
    .document-title {
      margin: 0;
      font-size: 24px;
      font-weight: 950;
      letter-spacing: -0.03em;
    }
    .document-subtitle {
      margin: 5px 0 0;
      color: var(--brown);
      font-size: 12px;
      font-weight: 800;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      overflow: hidden;
      border-radius: 10px;
      border: 1px solid rgba(227, 200, 131, 0.86);
    }
    thead th {
      padding: 9px 11px;
      background: var(--espresso);
      color: #fff;
      font-size: 10px;
      font-weight: 900;
      text-align: left;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    tbody td {
      padding: 11px;
      background: rgba(255, 252, 245, 0.86);
      border-top: 1px solid rgba(227, 200, 131, 0.55);
      color: var(--brown);
      font-size: 12px;
      font-weight: 800;
      vertical-align: top;
    }
    .amount { text-align: right; white-space: nowrap; }
    .totals {
      width: 290px;
      margin-left: auto;
      margin-top: 14px;
      border: 1px solid rgba(227, 200, 131, 0.86);
      border-radius: 10px;
      overflow: hidden;
      background: rgba(255, 252, 245, 0.78);
    }
    .total-row {
      display: flex;
      justify-content: space-between;
      gap: 18px;
      padding: 9px 12px;
      color: var(--brown);
      font-size: 12px;
      font-weight: 850;
      border-bottom: 1px solid rgba(227, 200, 131, 0.5);
    }
    .total-row:last-child {
      border-bottom: 0;
      background: rgba(214, 166, 46, 0.14);
      color: var(--espresso);
      font-size: 14px;
      font-weight: 950;
    }
    .notice {
      margin-top: 18px;
      padding: 11px 13px;
      border-radius: 10px;
      background: rgba(255, 117, 31, 0.10);
      border: 1px solid rgba(255, 117, 31, 0.26);
      color: var(--brown);
      font-size: 10.5px;
      font-weight: 800;
    }
    .footer {
      margin-top: 16px;
      padding-top: 10px;
      border-top: 1px solid rgba(227, 200, 131, 0.7);
      color: var(--muted);
      font-size: 9.5px;
      font-weight: 750;
    }
    @page { size: A4; margin: 0; }
    @media print {
      body { padding: 0; background: white; }
      .page { width: 210mm; min-height: 297mm; border: 0; border-radius: 0; box-shadow: none; }
    }
  </style>
</head>
<body>
  <main class="page">
    <header class="brand">
      <div class="brand-lockup">
        ${
          input.brand?.logoUrl
            ? `<img class="brand-logo" src="${escapeHtml(input.brand.logoUrl)}" alt="" />`
            : ""
        }
        <div>
          <h1 class="brand-title">Chin-Chin</h1>
          <p class="document-subtitle">Digitalna rezervacija ugostiteljskog objekta</p>
        </div>
      </div>
      <span class="pill">${escapeHtml(statusLabel(input.status))}</span>
    </header>

    <section class="title-block">
      <h2 class="document-title">${escapeHtml(input.documentTitle)}</h2>
      <p class="document-subtitle">Broj računa: ${escapeHtml(input.invoiceNumber)} · Izdano: ${escapeHtml(formatDate(input.issuedAt))}</p>
    </section>

    <section class="invoice-head">
      <div class="card">
        <p class="label">Izdavatelj</p>
        <p class="value">Chin-Chin</p>
        <p class="label">OIB</p>
        <p class="value">${escapeHtml(input.seller.oib)}</p>
        <p class="label">Adresa</p>
        <p class="value">${escapeHtml(input.seller.address || "—")}</p>
        <p class="label">Email</p>
        <p class="value">${escapeHtml(input.seller.email || "—")}</p>
      </div>
      <div class="card">
        <p class="label">Korisnik</p>
        <p class="value">${escapeHtml(input.buyer.name || "Chin-Chin korisnik")}</p>
        <p class="label">Email</p>
        <p class="value">${escapeHtml(input.buyer.email || "—")}</p>
        <p class="label">Rezervacija</p>
        <p class="value">${escapeHtml(input.reservation.venueName || "Chin-Chin objekt")}</p>
        <p class="label">Termin</p>
        <p class="value">${escapeHtml(formatDate(input.reservation.serviceDate))}</p>
      </div>
    </section>

    <section style="margin-top: 18px;">
      <table>
        <thead>
          <tr>
            <th>Opis usluge</th>
            <th>Objekt / stol</th>
            <th class="amount">Iznos</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>${escapeHtml(input.item.description)}</td>
            <td>${escapeHtml(venueAndTableLabel)}</td>
            <td class="amount">${escapeHtml(grossLabel)}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="totals">
      <div class="total-row">
        <span>Ukupno plaćeno</span>
        <span>${escapeHtml(grossLabel)}</span>
      </div>
      ${
        hasRefund
          ? `<div class="total-row">
        <span>Evidentirani povrat</span>
        <span>-${escapeHtml(refundedLabel)}</span>
      </div>`
          : ""
      }
      <div class="total-row">
        <span>Saldo</span>
        <span>${escapeHtml(netLabel)}</span>
      </div>
    </section>

    <section class="notice">
      Ovaj dokument odnosi se na naknadu za rezervaciju putem Chin-Chin aplikacije.
      Piće i hrana se naručuju i plaćaju u objektu, osim ako je drukčije navedeno u službenim uvjetima.
      ${input.note ? `<br />${escapeHtml(input.note)}` : ""}
    </section>

    <footer class="footer">
      Dokument je generiran elektronički putem Chin-Chin sustava. Računovodstveni i fiskalni elementi potvrđuju se prema važećem pravnom i poreznom okviru.
    </footer>
  </main>
</body>
</html>`;
}
