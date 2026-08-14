function normalizePhone(phone) {
    if (!phone) return "";
  
    // remove all non-numbers
    let cleaned = phone.replace(/\D/g, "");
  
    // already has country code
    if (cleaned.startsWith("91") && cleaned.length === 12) {
      return cleaned;
    }
  
    // add India code if 10 digit
    if (cleaned.length === 10) {
      return "91" + cleaned;
    }
  
    return cleaned;
  }
  
  module.exports = normalizePhone;