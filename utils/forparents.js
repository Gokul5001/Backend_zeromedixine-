const { sendTemplateMessage } = require("./superfone");

/**
 * Send WhatsApp to patient after Opliva submission
 */
async function sendforparentstConfirmation({ to, name }) {
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
async function sendforparentsAdminAlert({
  to,
  name,
  phone,
  age
}) {
  return sendTemplateMessage({
    to,
    templateName: "forparents_",
    language: "en_US",
    params: [
      name,
      phone,
      String(age)
    ]
  });
}

module.exports = {
    sendforparentstConfirmation,
    sendforparentsAdminAlert
};