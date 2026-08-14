// ─────────────────────────────────────────────────────────────────────────────
// REPLACE the handleConfirm function in ClinicBooking.jsx with this version.
//
// What changed vs the previous version:
//   • Single POST to /api/clinic-bookings  (no separate /create-link call)
//   • Backend creates ClinicBooking + Payment + Razorpay link in one shot
//   • Frontend receives { appointmentId, payment: { shortUrl } }
//   • Opens Razorpay modal using the returned shortUrl
// ─────────────────────────────────────────────────────────────────────────────

const handleConfirm = async () => {
  setLoading(true);
  setError("");

  try {
    // ── Step 1: Load Razorpay SDK early (cached after first call) ───────────
    const sdkLoaded = await loadRazorpayScript();
    if (!sdkLoaded) {
      throw new Error("Could not load Razorpay. Please check your internet connection.");
    }

    // ── Step 2: Create booking + payment link in one backend call ───────────
    setPayStep("booking");

    const fee = Number(doctor?.consultFee || 0);
    if (!fee) throw new Error("Consultation fee is not set for this doctor.");

    const bookRes = await fetch(`${BASE}/api/clinic-bookings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clinicId:     clinicId || doctor?.id,
        doctorName:   doctor?.name,
        clinicName:   doctor?.clinicName,
        sessionType:  booking.sessionType,
        date:         booking.date,
        time:         booking.time,
        patientName:  booking.patient.name,
        patientPhone: "91" + booking.patient.phone,   // E.164 without +
        patientEmail: booking.patient.email || "",
        patientAge:   booking.patient.age   || "",
        concern:      booking.patient.concern || "",
        notes:        booking.patient.notes   || "",
        amount:       fee,                             // rupees — backend converts to paise
        currency:     "INR",
        sendWhatsApp: true,
        assignedBy:   doctor?.name,
      }),
    });

    if (!bookRes.ok) {
      const errBody = await bookRes.json().catch(() => ({}));
      throw new Error(errBody?.message || `Booking failed (HTTP ${bookRes.status})`);
    }

    const bookData = await bookRes.json();
    if (!bookData.success) {
      throw new Error(bookData.message || "Failed to create booking");
    }

    // Store appointmentId for reference
    appointmentIdRef.current = bookData.appointmentId;

    const paymentUrl = bookData.payment?.shortUrl || bookData.payment?.longUrl;
    if (!paymentUrl) {
      throw new Error("Payment link was not returned. Please contact support.");
    }

    // ── Step 3: Open Razorpay modal ─────────────────────────────────────────
    setPayStep("razorpay");

    const rzpKey = import.meta.env.VITE_RAZORPAY_KEY_ID;

    if (!rzpKey) {
      // No frontend key → open payment link in new tab (fallback)
      window.open(paymentUrl, "_blank");
      // Optimistically show success — webhook will confirm actual payment
      await new Promise(r => setTimeout(r, 600));
      setSubmitted(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    // Full inline Razorpay checkout
    await new Promise((resolve, reject) => {
      const options = {
        key:         rzpKey,
        amount:      fee * 100,      // paise — informational
        currency:    "INR",
        name:        doctor?.clinicName || "Zeromedixine",
        description: `${booking.sessionType} – ${booking.patient.concern || "Consultation"}`,
        image:       "/logo.png",

        prefill: {
          name:    booking.patient.name,
          contact: "+91" + booking.patient.phone,
          email:   booking.patient.email || "",
        },
        notes: {
          clinicBookingId: bookData.appointmentId || "",
          sessionType:     booking.sessionType,
          concern:         booking.patient.concern,
        },
        theme:    { color: "#1e8fd3" },
        redirect: false,

        handler: function (response) {
          // response.razorpay_payment_id available here
          console.log("✅ Razorpay payment success:", response);
          resolve(response);
        },
        modal: {
          ondismiss:     () => reject(new Error("DISMISSED")),
          confirm_close: true,
          escape:        true,
        },
      };

      const rzp = new window.Razorpay(options);
      rzp.on("payment.failed", (resp) => {
        reject(new Error(resp?.error?.description || "Payment failed. Please try again."));
      });
      rzp.open();
    });

    // ── Step 4: Payment completed → show success screen ─────────────────────
    setSubmitted(true);
    window.scrollTo({ top: 0, behavior: "smooth" });

  } catch (err) {
    if (err.message === "DISMISSED") {
      setError("Payment was cancelled. You can try again.");
    } else {
      setError(err.message || "Something went wrong. Please try again.");
    }
  } finally {
    setLoading(false);
    setPayStep("");
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Also add this ref near the top of the ClinicBooking component
// (alongside the existing useState declarations):
//
//   const appointmentIdRef = useRef(null);
//
// And add this to your .env:
//   VITE_API_URL=http://localhost:5000
//   VITE_RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxxxxxx
// ─────────────────────────────────────────────────────────────────────────────
