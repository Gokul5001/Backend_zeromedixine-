const { sendTemplateMessage } = require("./superfone");

/**
 * Send WhatsApp to patient
 */
async function sendForParentsPatientConfirmation({ to, name }) {
  return sendTemplateMessage({
    to,
    templateName: "family_", // ✅ your approved template
    language: "en_US",
    params: [name || "Patient"]
  });
}

/**
 * Send WhatsApp to admin
 */
async function sendForParentsAdminAlert({
  to,
  name,
  phone,
  age
}) {
  return sendTemplateMessage({
    to,
    templateName: "new_", // 👈 create this in Superfone
    language: "en_US",
    params: [
      name,
      phone,
      String(age)
    ]
  });
}

module.exports = {
  sendForParentsPatientConfirmation,
  sendForParentsAdminAlert
};