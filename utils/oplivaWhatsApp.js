const { sendTemplateMessage } = require("./superfone");

/**
 * Send WhatsApp to patient after Opliva submission
 */
async function sendOplivaPatientConfirmation({ to, name }) {
  return sendTemplateMessage({
    to,
    templateName: process.env.SUPERFONE_OPLIVA_PATIENT_TEMPLATE || "opliva_lead_confirmation",
    language: "en_US",
    params: [
      name || "Patient"
    ]
  });
}

/**
 * Send WhatsApp to Sales/Admin about new lead
 */
async function sendOplivaAdminAlert({
  to,
  name,
  phone,
  age,
  promoCode        
}) {
  return sendTemplateMessage({
    to,
    templateName: "great_",
    language: "en_US",
    params: [
      name,
      phone,
      String(age),
      promoCode || "N/A"   // ✅ Add this as 4th param — maps to {{4}} in template

    ]
  });
}

module.exports = {
  sendOplivaPatientConfirmation,
  sendOplivaAdminAlert
};