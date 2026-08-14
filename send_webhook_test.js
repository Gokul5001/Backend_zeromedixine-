const crypto = require("crypto");
const axios = require("axios");

const secret = process.env.RAZORPAY_WEBHOOK_SECRET || "YOUR_WEBHOOK_SECRET_HERE";

const payloadObj = {
  event: "payment_link.paid",
  payload: {
    payment: {
      entity: {
        id: "test_payment_12345",
        payment_link_id: "plink_test12345",
        reference_id: "test-ref-111"
      }
    },
    payment_link: {
      entity: {
        id: "plink_test12345",
        reference_id: "test-ref-111"
      }
    }
  }
};

const payload = JSON.stringify(payloadObj);
const signature = crypto
  .createHmac("sha256", secret)
  .update(Buffer.from(payload))
  .digest("hex");

(async () => {
  try {
    const res = await axios.post(
      "https://www.zeromedixine.com/api/payments/webhook",
      payload,
      {
        headers: {
          "Content-Type": "application/json",
          "x-razorpay-signature": signature
        }
      }
    );

    console.log("Webhook sent! Status:", res.status);
    console.log("Response:", res.data);
  } catch (err) {
    console.error("Error sending webhook:", err.response?.data || err);
  }
})();
