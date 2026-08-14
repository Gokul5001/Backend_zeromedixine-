// utils/superfonenew.js

const axios = require("axios");

const SUPERFONE_API_KEY = process.env.SUPERFONE_API_KEY;
const SUPERFONE_BASE_URL = process.env.SUPERFONE_API_URL || "";

if (!SUPERFONE_API_KEY) {
  console.warn("❌ WARNING: SUPERFONE_API_KEY not set.");
}

/**
 * Normalize phone number to 91XXXXXXXXXX
 */
function normalizePhone(p) {
  if (!p) return "";
  let s = String(p).replace(/\D/g, "");
  if (s.length === 10) s = "91" + s;
  return s;
}

/**
 * Send WhatsApp template via Superfone Dragonfly API.
 *
 * For retargetting_wth_images:
 *   - headerImage: publicly accessible image URL (the campaign banner)
 *   - params: [name, painCondition]  →  {{1}}, {{2}} in the body
 */
async function sendTemplateMessage({
  to,
  templateName,
  language = "en",
  params = [],
  headerImage,    // ← IMAGE header (replaces headerDocument)
  headerDocument, // ← kept for backward-compat with other templates
}) {
  if (!to) throw new Error("Destination phone missing");
  if (!templateName) throw new Error("templateName required");

  const recipient = normalizePhone(to);

  if (!Array.isArray(params)) {
    throw new Error(`Template "${templateName}" params must be an array`);
  }

  const components = [];

  // ── IMAGE HEADER ──────────────────────────────────────────────
  if (headerImage) {
    components.push({
      type: "header",
      parameters: [
        {
          type: "image",
          image: {
            link: headerImage,
          },
        },
      ],
    });
  }

  // ── DOCUMENT HEADER (legacy / other templates) ────────────────
  if (!headerImage && headerDocument) {
    const urlPath = headerDocument.split("?")[0];
    const extractedName = urlPath.split("/").pop();
    const filename =
      extractedName && extractedName.endsWith(".pdf")
        ? extractedName
        : "document.pdf";

    components.push({
      type: "header",
      parameters: [
        {
          type: "document",
          document: {
            link: headerDocument,
            filename,
          },
        },
      ],
    });
  }

  // ── BODY VARIABLES ────────────────────────────────────────────
  if (params.length > 0) {
    components.push({
      type: "body",
      parameters: params.map((v) => ({
        type: "text",
        text: String(v),
      })),
    });
  }

  const payload = {
    type: "template",
    templateName,
    language,
    recipient,
    components,
  };

  console.log("📤 FINAL Superfone payload:", JSON.stringify(payload, null, 2));

  const url = `${SUPERFONE_BASE_URL}/whatsapp/messages`;

  try {
    const resp = await axios.post(url, payload, {
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "x-api-key": SUPERFONE_API_KEY,
      },
    });
    console.log("✅ Superfone success:", resp.data);
    return resp.data;
  } catch (err) {
    console.error(
      "❌ Superfone error:",
      err.response?.status,
      err.response?.data || err.message
    );
    throw new Error(
      err.response?.data?.message ||
        "Superfone Dragonfly WhatsApp send failed"
    );
  }
}

// Consent form sender (unchanged)
async function sendConsentFormMessage({ to, patientName, formLink, doctorName }) {
  return sendTemplateMessage({
    to,
    templateName:
      process.env.SUPERFONE_CONSENT_TEMPLATE || "consent_form_request",
    language: "en",
    params: [patientName || "Patient", formLink, doctorName || "Doctor"],
  });
}

module.exports = { sendTemplateMessage, sendConsentFormMessage };
