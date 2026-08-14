// utils/aisensy.js
const axios = require("axios");

const AISENSY_API_KEY = process.env.AISENSY_API_KEY;
const AISENSY_BASE_URL = process.env.AISENSY_API_URL || "https://backend.aisensy.com";
const BUSINESS_NAME = process.env.BUSINESS_NAME || "Zeromedixine";
const DEFAULT_CAMPAIGN = process.env.AISENSY_CAMPAIGN_NAME || null; // set this in env if you have a default campaign

if (!AISENSY_API_KEY) {
  console.warn("❌ WARNING: AISENSY_API_KEY not set.");
}

function safeUserNameFrom(paramsOrName) {
  const candidate = Array.isArray(paramsOrName) && paramsOrName.length && paramsOrName[0]
    ? String(paramsOrName[0])
    : (typeof paramsOrName === "string" && paramsOrName ? paramsOrName : BUSINESS_NAME);
  const cleaned = candidate.replace(/[^A-Za-z0-9 .\-]/g, "").trim().slice(0, 50);
  return cleaned || BUSINESS_NAME;
}

async function sendTemplateMessage({ to, campaignName, templateName, params = [] }) {
  // campaignName: REQUIRED — this must be the API Campaign name you created in AiSensy
  // templateName: optional descriptive slug if you want to track which template used locally
  const destination = String(to).replace(/\+/g, "").trim();
  const userName = safeUserNameFrom(params);
  const campaign = campaignName || DEFAULT_CAMPAIGN;

  if (!campaign) {
    throw new Error("AiSensy campaignName is required. Create an API Campaign in AiSensy and set AISENSY_CAMPAIGN_NAME or pass campaignName.");
  }

  console.log(`📱 AiSensy: sending campaign "${campaign}" to ${destination} (template: ${templateName || "<unknown>"}).`);

  const payload = {
    apiKey: AISENSY_API_KEY,
    campaignName: "document_greeting",
    destination,
    userName: "Zeromedixine",
    source: "Zeromedixine_App",
    templateParams: [
      "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf"
    ]
  };
  

  const url = `${AISENSY_BASE_URL}/campaign/t1/api/v2`;
  try {
    console.log(`🔄 POST ${url} payload:`, payload);
    const resp = await axios.post(url, payload, { headers: { "Content-Type": "application/json" }, timeout: 15000 });
    console.log("✅ AiSensy send success:", resp.data);
    return resp.data;
  } catch (err) {
    // give full debug info
    console.error("❌ AiSensy Campaign API error:", err.response?.status, err.response?.data || err.message);
    const finalError = new Error(`AiSensy Campaign API failed for ${templateName || campaign}`);
    finalError.debug = { status: err.response?.status, data: err.response?.data };
    throw finalError;
  }
}

async function sendConsentFormMessage({ to, patientName, formLink, doctorName }) {
  try {
    const payload = {
      apiKey: process.env.AISENSY_API_KEY,
      campaignName: process.env.AISENSY_CONSENT_CAMPAIGN,
      destination: to,
      userName: patientName,
      source: "Zeromedixine_App",
      templateParams: [
        patientName,
        formLink,
        doctorName
      ]
    };

    console.log("📤 AiSensy: Sending payload:", payload);

    const res = await axios.post(
      "https://backend.aisensy.com/campaign/t1/api/v2",
      payload,
      { headers: { "Content-Type": "application/json" } }
    );

    console.log("✔ AiSensy success:", res.data);
    return res.data;

  } catch (err) {
    console.error("❌ AiSensy error:", err?.response?.data || err);
    throw new Error("AiSensy Campaign API failed");
  }
}




module.exports = { sendTemplateMessage, sendConsentFormMessage };
