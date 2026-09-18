import {
  customerLanguageCode,
  customerLocale,
  isEnglishCustomer,
} from "../shared/customer-language";

export type CustomerInvoiceTemplateInput = {
  languageCode?: string | null;
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

function formatDate(value?: Date | null, languageCode?: string | null) {
  if (!value) {
    return "—";
  }
  return new Intl.DateTimeFormat(customerLocale(languageCode), {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Zagreb",
  }).format(value);
}

function formatMoney(
  cents: number,
  currency: string,
  languageCode?: string | null,
) {
  const key = currency.trim().toUpperCase() || "EUR";
  const cacheKey = `${customerLanguageCode(languageCode)}:${key}`;
  let formatter = formatterCache.get(cacheKey);
  if (!formatter) {
    formatter = new Intl.NumberFormat(customerLocale(languageCode), {
      style: "currency",
      currency: key,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    formatterCache.set(cacheKey, formatter);
  }
  return formatter.format(cents / 100);
}

function statusLabel(status: string, languageCode?: string | null) {
  const en = isEnglishCustomer(languageCode);
  switch (status.trim().toUpperCase()) {
    case "REFUNDED":
      return en
        ? "Invoice voided / refund recorded"
        : "Račun storniran / povrat evidentiran";
    case "PARTIALLY_REFUNDED":
      return en ? "Partial refund recorded" : "Djelomični povrat evidentiran";
    case "VOIDED":
      return en ? "Invoice voided" : "Račun poništen";
    default:
      return en ? "Issued" : "Izdano";
  }
}

function localizedTableLabel(
  value?: string | null,
  languageCode?: string | null,
) {
  const en = isEnglishCustomer(languageCode);
  const raw = value?.trim();
  if (!raw) {
    return "";
  }

  return raw
    .replace(/^table\s+/i, en ? "Table " : "Stol ")
    .replace(/^room\s+/i, en ? "Room " : "Prostorija ")
    .replace(/\btable\b/gi, en ? "table" : "stol")
    .replace(/\broom\b/gi, en ? "room" : "prostorija")
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

function localizedTableLabelWithType(
  value?: string | null,
  languageCode?: string | null,
) {
  const tableLabel = localizedTableLabel(value, languageCode);
  const suffix = tableTypeSuffix(value);

  if (!tableLabel) {
    return suffix
      ? `${isEnglishCustomer(languageCode) ? "Table" : "Stol"} ${suffix}`
      : "";
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
  const en = isEnglishCustomer(input.languageCode);
  const documentTitle = en
    ? input.documentTitle.replace(
        /Račun za uslugu rezervacije/i,
        "Reservation service invoice",
      )
    : input.documentTitle;
  const itemDescription = en
    ? input.item.description.replace(
        /Naknada za rezervaciju stola/i,
        "Table reservation fee",
      )
    : input.item.description;
  const note = en
    ? input.note
        ?.replace(
          /Računovodstveni\/fiskalni format i PDF predložak potvrđuje knjigovođa prije produkcije\./i,
          "Accounting/fiscal format and PDF template are confirmed by the accountant before production.",
        )
        .replace(
          /Ovaj dokument odnosi se na naknadu za rezervaciju putem Chin-Chin aplikacije\. Piće i hrana se naručuju i plaćaju u objektu, osim ako je drukčije navedeno u službenim uvjetima\./i,
          "This document relates to the reservation fee through the Chin-Chin app. Drinks and food are ordered and paid at the venue, unless official terms state otherwise.",
        )
    : input.note;
  const grossLabel = formatMoney(
    input.item.amountCents,
    input.item.currency,
    input.languageCode,
  );
  const refundedLabel = formatMoney(
    input.item.refundedCents,
    input.item.currency,
    input.languageCode,
  );
  const netCents = Math.max(
    0,
    input.item.amountCents - input.item.refundedCents,
  );
  const netLabel = formatMoney(
    netCents,
    input.item.currency,
    input.languageCode,
  );
  const hasRefund = input.item.refundedCents > 0;
  const tableLabel = localizedTableLabelWithType(
    input.reservation.tableLabel,
    input.languageCode,
  );
  const venueAndTableLabel =
    [input.reservation.venueName, tableLabel].filter(Boolean).join(" · ") ||
    "—";

  return `<!doctype html>
<html lang="${customerLanguageCode(input.languageCode)}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(documentTitle)} ${escapeHtml(input.invoiceNumber)}</title>
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
      <span class="pill">${escapeHtml(statusLabel(input.status, input.languageCode))}</span>
    </header>

    <section class="title-block">
      <h2 class="document-title">${escapeHtml(documentTitle)}</h2>
      <p class="document-subtitle">${en ? "Invoice number" : "Broj računa"}: ${escapeHtml(input.invoiceNumber)} · ${en ? "Issued" : "Izdano"}: ${escapeHtml(formatDate(input.issuedAt, input.languageCode))}</p>
    </section>

    <section class="invoice-head">
      <div class="card">
        <p class="label">${en ? "Issuer" : "Izdavatelj"}</p>
        <p class="value">Chin-Chin</p>
        <p class="label">OIB</p>
        <p class="value">${escapeHtml(input.seller.oib)}</p>
        <p class="label">${en ? "Address" : "Adresa"}</p>
        <p class="value">${escapeHtml(input.seller.address || "—")}</p>
        <p class="label">Email</p>
        <p class="value">${escapeHtml(input.seller.email || "—")}</p>
      </div>
      <div class="card">
        <p class="label">${en ? "Customer" : "Korisnik"}</p>
        <p class="value">${escapeHtml(input.buyer.name || (en ? "Chin-Chin customer" : "Chin-Chin korisnik"))}</p>
        <p class="label">Email</p>
        <p class="value">${escapeHtml(input.buyer.email || "—")}</p>
        <p class="label">${en ? "Reservation" : "Rezervacija"}</p>
        <p class="value">${escapeHtml(input.reservation.venueName || (en ? "Chin-Chin venue" : "Chin-Chin objekt"))}</p>
        <p class="label">${en ? "Time" : "Termin"}</p>
        <p class="value">${escapeHtml(formatDate(input.reservation.serviceDate, input.languageCode))}</p>
      </div>
    </section>

    <section style="margin-top: 18px;">
      <table>
        <thead>
          <tr>
            <th>${en ? "Service description" : "Opis usluge"}</th>
            <th>${en ? "Venue / table" : "Objekt / stol"}</th>
            <th class="amount">${en ? "Amount" : "Iznos"}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>${escapeHtml(itemDescription)}</td>
            <td>${escapeHtml(venueAndTableLabel)}</td>
            <td class="amount">${escapeHtml(grossLabel)}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="totals">
      <div class="total-row">
        <span>${en ? "Total paid" : "Ukupno plaćeno"}</span>
        <span>${escapeHtml(grossLabel)}</span>
      </div>
      ${
        hasRefund
          ? `<div class="total-row">
        <span>${en ? "Recorded refund" : "Evidentirani povrat"}</span>
        <span>-${escapeHtml(refundedLabel)}</span>
      </div>`
          : ""
      }
      <div class="total-row">
        <span>${en ? "Balance" : "Saldo"}</span>
        <span>${escapeHtml(netLabel)}</span>
      </div>
    </section>

    <section class="notice">
      ${en ? "This document relates to the reservation fee through the Chin-Chin app. Drinks and food are ordered and paid at the venue, unless official terms state otherwise." : "Ovaj dokument odnosi se na naknadu za rezervaciju putem Chin-Chin aplikacije. Piće i hrana se naručuju i plaćaju u objektu, osim ako je drukčije navedeno u službenim uvjetima."}
      ${note ? `<br />${escapeHtml(note)}` : ""}
    </section>

    <footer class="footer">
      ${en ? "This document was generated electronically through the Chin-Chin system. Accounting and fiscal elements are confirmed according to the applicable legal and tax framework." : "Dokument je generiran elektronički putem Chin-Chin sustava. Računovodstveni i fiskalni elementi potvrđuju se prema važećem pravnom i poreznom okviru."}
    </footer>
  </main>
</body>
</html>`;
}
