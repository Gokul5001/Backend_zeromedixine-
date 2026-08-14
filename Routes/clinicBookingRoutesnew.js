// // routes/clinicBookingRoutesnew.js
// // Mounted at: app.use("/api/clinic-bookings", clinicBookingRoutes)

// const express   = require("express");
// const router    = express.Router();
// const Razorpay  = require("razorpay");
// const { v4: uuidv4 } = require("uuid");

// const ClinicBooking = require("../Models/ClinicBookingModel");
// const Payment       = require("../Models/Payment");
// const { sendTemplateMessage } = require("../utils/superfone");
// const crypto = require("crypto"); // add at top of file if not already there
// const PhysioAppointment = require("../Models/PhysioAppointment");
// const Doctor = require("../Models/Doctor"); // to look up doctor_id from booking
// const multer = require("multer");
// const { uploadToDriveOAuth } = require("../lib/drive-oauth");
// const { verifyDoctorToken }  = require("./doctorOtpAuth");
// const Patient = require("../Models/Patient");


// const audioUpload = multer({
//   storage: multer.memoryStorage(),
//   limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
//   fileFilter: (req, file, cb) => {
//     const allowed = [
//       "audio/mpeg", "audio/mp3", "audio/mp4",
//       "audio/webm", "audio/ogg", "audio/wav", "audio/x-m4a"
//     ];
//     allowed.includes(file.mimetype)
//       ? cb(null, true)
//       : cb(new Error("Only audio files are allowed"));
//   },
// });


// // ── Razorpay instance (reuse trimmed keys pattern from paymentRoutes) ─────────
// function trimmedEnv(key) {
//   const v = process.env[key];
//   return (typeof v === "string" ? v.trim() : null) || null;
// }
// const razorpay = new Razorpay({
//   key_id:     trimmedEnv("RAZORPAY_KEY_ID")     || "",
//   key_secret: trimmedEnv("RAZORPAY_KEY_SECRET") || "",
// });


// router.post(
//   "/appointments/session-notes",
//   verifyDoctorToken,
//   audioUpload.single("voice_note"),
//   async (req, res) => {
//     try {
//       const { id } = req.query;  // ← from ?id=...

//       if (!id) {
//         return res.status(400).json({ success: false, message: "id query parameter is required" });
//       }

//       // ── Fetch appointment ───────────────────────────────────────────────
//       const appt = await PhysioAppointment.findById(id);
//       if (!appt) {
//         return res.status(404).json({ success: false, message: "Appointment not found" });
//       }

//       // ── Verify doctor owns this appointment ─────────────────────────────
//       if (appt.doctor_id !== req.doctor.doctor_id) {
//         return res.status(403).json({
//           success: false,
//           message: "You are not authorized to update this appointment",
//         });
//       }

//       // ── Build update object ─────────────────────────────────────────────
//       const updates = {
//         session_notes_saved_at: new Date(),
//       };

//       if (req.body.notes !== undefined) {
//         updates.session_notes = req.body.notes.trim() || null;
//       }

//       // ── Upload voice note to Google Drive if provided ───────────────────
//       if (req.file) {
//         try {
//           const filename = `session_voice_${id}_${Date.now()}_${req.file.originalname}`;
//           const result   = await uploadToDriveOAuth(
//             req.file.buffer,
//             filename,
//             req.file.mimetype
//           );
//           updates.session_voice_note =
//             result?.webViewLink ||
//             (result?.id ? `https://drive.google.com/file/d/${result.id}/view` : null);

//           console.log(`✅ Session voice note uploaded: ${updates.session_voice_note}`);
//         } catch (driveErr) {
//           console.error("Drive upload failed:", driveErr.message);
//           return res.status(500).json({
//             success: false,
//             message: "Voice note upload to Drive failed",
//             error:   driveErr.message,
//           });
//         }
//       }

//       // ── Nothing to save? ────────────────────────────────────────────────
//       if (!updates.session_notes && !updates.session_voice_note) {
//         return res.status(400).json({
//           success: false,
//           message: "Provide at least one of: notes (text) or voice_note (audio file)",
//         });
//       }

//       // ── Save to DB ──────────────────────────────────────────────────────
//       const updated = await PhysioAppointment.findByIdAndUpdate(
//         id,
//         { $set: updates },
//         { new: true }
//       );

//       return res.json({
//         success: true,
//         message: "Session notes saved",
//         appointment: {
//           id:                     updated._id,
//           session_notes:          updated.session_notes,
//           session_voice_note:     updated.session_voice_note,
//           session_notes_saved_at: updated.session_notes_saved_at,
//         },
//       });

//     } catch (err) {
//       console.error("POST /session-notes error:", err);
//       return res.status(500).json({
//         success: false,
//         message: "Server error saving session notes",
//         error:   String(err?.message || err),
//       });
//     }
//   }
// );



// // GET /api/clinics/new-bookings/appointments?doctor_id=doc_002&status=confirmed
// router.get("/appointments", async (req, res) => {
//   try {
//     const {
//       doctor_id,
//       status   = "confirmed",
//       page     = 1,
//       limit    = 20,
//       fromDate = null,
//       toDate   = null,
//     } = req.query;  // ← all from query now

//     if (!doctor_id) {
//       return res.status(400).json({ success: false, message: "doctor_id is required" });
//     }

//     const filter = { doctor_id };

//     if (status && status !== "all") {
//       filter.status = status;
//     }

//     if (fromDate || toDate) {
//       filter.date = {};
//       if (fromDate) filter.date.$gte = fromDate;
//       if (toDate)   filter.date.$lte = toDate;
//     }

//     const pageNum  = Math.max(1, parseInt(page, 10));
//     const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
//     const skip     = (pageNum - 1) * limitNum;

//     const [appointments, total] = await Promise.all([
//       PhysioAppointment.find(filter)
//         .sort({ booked_at: -1 })
//         .skip(skip)
//         .limit(limitNum)
//         .lean(),
//       PhysioAppointment.countDocuments(filter),
//     ]);

//     return res.json({
//       success: true,
//       total,
//       page:       pageNum,
//       limit:      limitNum,
//       totalPages: Math.ceil(total / limitNum),
//       appointments,
//     });

//   } catch (err) {
//     console.error("GET /appointments error:", err);
//     return res.status(500).json({
//       success: false,
//       message: "Failed to fetch appointments",
//       error:   String(err?.message || err),
//     });
//   }
// });




// // ─────────────────────────────────────────────────────────────────────────────
// // POST /api/clinic-bookings
// // 1. Save ClinicBooking document
// // 2. Create Razorpay payment link
// // 3. Save Payment document
// // 4. Embed payment info back into ClinicBooking
// // 5. Send WhatsApp (best-effort)
// // Returns: { success, appointmentId, payment: { shortUrl, linkId } }
// // ─────────────────────────────────────────────────────────────────────────────
// router.post("/", async (req, res) => {
//   try {
//     const {
//       clinicId,
//       doctorName,
//       clinicName,
//       sessionType = "In-clinic",
//       date,
//       time,
//       patientName,
//       patientPhone,
//       patientEmail = "",
//       patientAge   = "",
//       concern      = "",
//       notes        = "",
//       amount,                   // consultation fee in rupees (e.g. 499)
//       currency     = "INR",
//       sendWhatsApp = true,
//       assignedBy   = null,
//     } = req.body || {};

//     // ── Basic validation ────────────────────────────────────────────────────
//     if (!clinicId) {
//       return res.status(400).json({ success: false, message: "clinicId is required" });
//     }
//     if (!patientName || !patientPhone) {
//       return res.status(400).json({ success: false, message: "patientName and patientPhone are required" });
//     }
//     if (amount === undefined || amount === null || Number(amount) <= 0) {
//       return res.status(400).json({ success: false, message: "amount (consultation fee) is required" });
//     }

//     // ── Step 1: Save ClinicBooking ──────────────────────────────────────────
//     const booking = new ClinicBooking({
//       clinicId,
//       doctorName,
//       clinicName,
//       sessionType,
//       date,
//       time,
//       patientName,
//       patientPhone,
//       patientEmail,
//       patientAge,
//       concern,
//       notes,
//       status: "payment_initiated",
//     });
//     await booking.save();

//     const bookingId = booking._id.toString();

//     // ── Step 2: Prepare Razorpay link ───────────────────────────────────────
//     const currencyUpper  = String(currency).toUpperCase();
//     const multiplier     = currencyUpper === "JPY" ? 1 : 100;
//     const amountSmallest = Math.round(Number(amount) * multiplier);

//     // reference_id: compact, <= 40 chars
//     const shortSuffix = uuidv4().split("-")[0];                    // 8 chars
//     let referenceId   = `cb-${bookingId.slice(-16)}-${shortSuffix}`;
//     if (referenceId.length > 40) referenceId = referenceId.slice(0, 40);

//     const description = `${sessionType} – ${concern || "Consultation"} (${patientName})`;

//     // ── Step 3: Save Payment document (before calling Razorpay) ────────────
//     const paymentDoc = new Payment({
//       appointmentId: bookingId,          // store booking _id here
//       amount:        amountSmallest,
//       currency:      currencyUpper,
//       referenceId,
//       purpose:       description,
//       customer: {
//         name:    patientName,
//         contact: patientPhone,
//         email:   patientEmail || null,
//       },
//       status: "created",
//       raw:    { createdBy: "clinic-booking", clinicBookingId: bookingId },
//     });
//     await paymentDoc.save();

//     // ── Step 4: Create Razorpay payment link ────────────────────────────────
//     const rzpPayload = {
//       amount:         amountSmallest,
//       currency:       currencyUpper,
//       accept_partial: false,
//       reference_id:   referenceId,
//       description,
//       customer: {
//         name:    patientName,
//         contact: patientPhone.toString().replace(/\D/g, ""),
//         email:   patientEmail || "",
//       },
//       notify:          { sms: false, email: false },
//       callback_url:    process.env.FRONTEND_URL
//                          ? `${process.env.FRONTEND_URL}/clinic/booking-success`
//                          : "",
//       callback_method: "get",
//     };

//     let link;
//     try {
//       link = await razorpay.paymentLink.create(rzpPayload);
//     } catch (rzpErr) {
//       console.error("Razorpay create-link error:", rzpErr?.error || rzpErr);
//       // Still return the booking ID so the frontend can retry payment later
//       paymentDoc.raw = { ...paymentDoc.raw, razorpay_error: rzpErr };
//       await paymentDoc.save().catch(() => {});
//       return res.status(rzpErr.statusCode || 500).json({
//         success: false,
//         message: "Booking saved but payment link creation failed",
//         appointmentId: bookingId,
//         error: rzpErr?.error || String(rzpErr),
//       });
//     }

//     // ── Step 5: Persist link info ───────────────────────────────────────────
//     paymentDoc.linkId       = link.id;
//     paymentDoc.linkShortUrl = link.short_url || null;
//     paymentDoc.linkLongUrl  = link.long_url  || null;
//     paymentDoc.raw          = { ...paymentDoc.raw, razorpay_link: link };
//     await paymentDoc.save();

//     // Embed payment summary into ClinicBooking
//     booking.payment = {
//       paymentDocId: paymentDoc._id,
//       linkId:       link.id,
//       shortUrl:     link.short_url || null,
//       referenceId,
//       amount:       amountSmallest,
//       currency:     currencyUpper,
//       status:       "created",
//     };
//     await booking.save();

//     // ── Step 6: WhatsApp confirmation (best-effort) ─────────────────────────
//     if (sendWhatsApp && patientPhone) {
//       try {
//         const displayAmt  = (amountSmallest / multiplier).toFixed(2);
//         const amtDisplay  = currencyUpper === "INR" ? displayAmt : `${currencyUpper} ${displayAmt}`;
//         const paymentLink = link.short_url || link.long_url || "";

//         await sendTemplateMessage({
//           to:           patientPhone,
//           templateName: process.env.SUPERFONE_PAYMENT_TEMPLATE || "payment_getting",
//           language:     "en",
//           params: [
//             patientName,
//             concern || sessionType || "clinic session",
//             amtDisplay,
//             paymentLink,
//             assignedBy || doctorName || "Doctor",
//           ],
//         });
//         console.log("✅ WhatsApp sent to:", patientPhone);
//       } catch (waErr) {
//         console.error("❌ WhatsApp send error:", waErr.message || waErr);
//         // non-fatal — continue
//       }
//     }

//     // ── Final response ──────────────────────────────────────────────────────
//     return res.status(201).json({
//       success:       true,
//       appointmentId: bookingId,
//       booking:       booking,
//       payment: {
//         linkId:    link.id,
//         shortUrl:  link.short_url  || null,
//         longUrl:   link.long_url   || null,
//         referenceId,
//       },
//     });

//   } catch (err) {
//     console.error("POST /api/clinic-bookings error:", err);
//     return res.status(500).json({
//       success: false,
//       message: "Server error creating clinic booking",
//       error:   String(err?.message || err),
//     });
//   }
// });


// router.get("/booked-slots", async (req, res) => {
//   try {
//     const { clinicId, date } = req.query;

//     if (!clinicId || !date) {
//       return res.status(400).json({ success: false, message: "clinicId and date are required" });
//     }

//     const mongoose = require("mongoose");

//     // Match either by doctor_ref (Mongo ObjectId) or doctor_id string fallback
//     const doctorFilter = mongoose.Types.ObjectId.isValid(clinicId)
//       ? { $or: [{ doctor_ref: clinicId }, { doctor_id: clinicId }] }
//       : { doctor_id: clinicId };

//     const PENDING_LOCK_MINUTES = 15;
//     const pendingCutoff = new Date(Date.now() - PENDING_LOCK_MINUTES * 60 * 1000);

//     const filter = {
//       date,
//       $and: [
//         doctorFilter,
//         {
//           $or: [
//             { status: "confirmed" },
//             { status: "pending_payment", booked_at: { $gte: pendingCutoff } },
//           ],
//         },
//       ],
//     };

//     const appointments = await PhysioAppointment.find(filter)
//       .select("time status")
//       .lean();

//     const bookedTimes = appointments.map(a => a.time).filter(Boolean);

//     return res.json({ success: true, bookedTimes });

//   } catch (err) {
//     console.error("GET /booked-slots error:", err);
//     return res.status(500).json({
//       success: false,
//       message: "Failed to fetch booked slots",
//       error: String(err?.message || err),
//     });
//   }
// });

// // ─────────────────────────────────────────────────────────────────────────────
// // GET /api/clinic-bookings/:id
// // Fetch a single clinic booking by ID
// // ─────────────────────────────────────────────────────────────────────────────
// router.get("/:id", async (req, res) => {
//   try {
//     const booking = await ClinicBooking.findById(req.params.id).lean();
//     if (!booking) {
//       return res.status(404).json({ success: false, message: "Booking not found" });
//     }
//     return res.json({ success: true, booking });
//   } catch (err) {
//     return res.status(500).json({ success: false, message: "Server error", error: String(err) });
//   }
// });




// // ─────────────────────────────────────────────────────────────────────────────
// // GET /api/clinic-bookings/clinic/:clinicId
// // List all bookings for a clinic (newest first)
// // ─────────────────────────────────────────────────────────────────────────────
// router.get("/clinic/:clinicId", async (req, res) => {
//   try {
//     const { status, limit = 50, skip = 0 } = req.query;
//     const query = { clinicId: req.params.clinicId };
//     if (status) query.status = status;

//     const bookings = await ClinicBooking
//       .find(query)
//       .sort({ createdAt: -1 })
//       .skip(Number(skip))
//       .limit(Number(limit))
//       .lean();

//     const total = await ClinicBooking.countDocuments(query);

//     return res.json({ success: true, total, bookings });
//   } catch (err) {
//     return res.status(500).json({ success: false, message: "Server error", error: String(err) });
//   }
// });


// // ─────────────────────────────────────────────────────────────────────────────
// // PATCH /api/clinic-bookings/:id/status
// // Update booking status (e.g. after webhook confirms payment)
// // Body: { status: "confirmed" | "cancelled" | "no_show" }
// // ─────────────────────────────────────────────────────────────────────────────
// router.patch("/:id/status", async (req, res) => {
//   try {
//     const { status } = req.body || {};
//     const allowed = ["pending", "payment_initiated", "confirmed", "cancelled", "no_show"];
//     if (!allowed.includes(status)) {
//       return res.status(400).json({ success: false, message: `status must be one of: ${allowed.join(", ")}` });
//     }

//     const booking = await ClinicBooking.findByIdAndUpdate(
//       req.params.id,
//       { $set: { status } },
//       { new: true }
//     );
//     if (!booking) return res.status(404).json({ success: false, message: "Booking not found" });

//     return res.json({ success: true, booking });
//   } catch (err) {
//     return res.status(500).json({ success: false, message: "Server error", error: String(err) });
//   }
// });


// // ─────────────────────────────────────────────────────────────────────────────
// // POST /api/clinic-bookings/webhook/payment-paid
// // Called by Razorpay webhook (or from your existing paymentRoutes webhook)
// // to mark a clinic booking as confirmed after payment
// // Body: { referenceId, razorpayPaymentId }
// // ─────────────────────────────────────────────────────────────────────────────
// router.post("/webhook/payment-paid", async (req, res) => {
//   try {
//     const { referenceId, razorpayPaymentId, linkId } = req.body || {};

//     let booking = null;

//     if (linkId) {
//       booking = await ClinicBooking.findOne({ "payment.linkId": linkId });
//     }
//     if (!booking && referenceId) {
//       booking = await ClinicBooking.findOne({ "payment.referenceId": referenceId });
//     }

//     if (!booking) {
//       return res.status(404).json({ success: false, message: "ClinicBooking not found for this payment" });
//     }

//     booking.status             = "confirmed";
//     booking.payment.status     = "paid";
//     booking.payment.paidAt     = new Date();
//     await booking.save();

//     // Also update the Payment document
//     if (booking.payment.paymentDocId) {
//       await Payment.findByIdAndUpdate(booking.payment.paymentDocId, {
//         $set: {
//           status:              "paid",
//           razorpay_payment_id: razorpayPaymentId || null,
//           paidAt:              new Date(),
//         },
//       }).catch(() => {});
//     }

//     return res.json({ success: true, bookingId: booking._id });
//   } catch (err) {
//     console.error("clinic booking webhook error:", err);
//     return res.status(500).json({ success: false, message: "Server error", error: String(err) });
//   }
// });




// // ─────────────────────────────────────────────────────────────────────────────
// // POST /api/clinics/new-bookings/create-order
// // Creates ClinicBooking + PhysioAppointment + Razorpay order
// // Returns: { success, appointmentId, physioAppointmentId, orderId, amount, currency, keyId }
// // ─────────────────────────────────────────────────────────────────────────────
// router.post("/create-order", async (req, res) => {
//   try {
//     const {
//       clinicId,
//       doctorName,
//       clinicName,
//       sessionType  = "In-clinic",
//       date, 
//       time,
//       patientName,
//       patientPhone,
//       patientEmail = "",
//       patientAge   = "",
//       concern      = "",
//       notes        = "",
//       amount,
//       currency     = "INR",
//       assignedBy   = null,
//     } = req.body || {};
 
//     if (!clinicId)                      return res.status(400).json({ success: false, message: "clinicId is required" });
//     if (!patientName || !patientPhone)  return res.status(400).json({ success: false, message: "patientName and patientPhone are required" });
//     if (!amount || Number(amount) <= 0) return res.status(400).json({ success: false, message: "amount is required" });
 
    
//     // ── Step 1: Create ClinicBooking ────────────────────────────────────────
//     const booking = new ClinicBooking({
//       clinicId, doctorName, clinicName,
//       sessionType, date, time,
//       patientName, patientPhone, patientEmail, patientAge,
//       concern, notes,
//       status: "payment_initiated",
//     });
//     await booking.save();
//     const bookingId = booking._id.toString();
 
//     // ── Step 2: Look up doctor using the top-level Doctor import ───────────
//     // clinicId from frontend = doctor MongoDB _id (ObjectId string)
//     let doctor_id  = null;
//     let doctor_ref = null;
//     try {
//       const doc = await Doctor.findById(clinicId).lean();
//       if (doc) {
//         doctor_id  = doc.doctor_id;   // "doc_001"
//         doctor_ref = doc._id;
//         console.log(`✅ Doctor found: ${doctor_id}`);
//       } else {
//         console.warn(`⚠️  No Doctor document found for clinicId: ${clinicId}`);
//       }
//     } catch (e) {
//       console.warn("Doctor lookup failed:", e.message);
//     }
 
//     // ── Step 3: Validate doctor_id before creating PhysioAppointment ───────
//     if (!doctor_id) {
//       // Fallback: if clinicId itself looks like a doctor_id string (doc_001), use it directly
//       if (typeof clinicId === "string" && clinicId.startsWith("doc_")) {
//         doctor_id = clinicId;
//         console.warn(`⚠️  Using clinicId as doctor_id fallback: ${doctor_id}`);
//       } else {
//         return res.status(400).json({
//           success: false,
//           message: `Doctor not found for clinicId: ${clinicId}. Cannot create appointment.`,
//         });
//       }
//     }
 
//     // ── Look up patient_id from Patient collection ──
// let patient_id = null;
// try {
//   const normPhone = String(patientPhone).replace(/\D/g, "").replace(/^91/, "").slice(-10);
//   const patientDoc = await Patient.findOne({ phone_number: normPhone }).lean();
//   if (patientDoc) patient_id = patientDoc.patient_id;
// } catch (e) {
//   console.warn("Patient lookup for patient_id failed:", e.message);
// }

//     // ── Step 4: Create PhysioAppointment (pending_payment) ─────────────────
//     const physioAppt = await PhysioAppointment.create({
//       doctor_id,
//       doctor_ref:        doctor_ref || undefined,
//       patient_id,                         // ← add this
//       patient_name:      patientName,
//       patient_phone:     patientPhone,
//       patient_email:     patientEmail || null,
//       patient_age:       patientAge   || null,
//       concern:           concern      || null,
//       session_type:      sessionType,
//       date:              date         || null,
//       time:              time         || null,
//       notes:             notes        || null,
//       status:            "pending_payment",
//       amount_paid:       Math.round(Number(amount) * 100),
//       currency:          String(currency).toUpperCase(),
//       clinic_booking_id: booking._id,
//     });
//     console.log(`✅ PhysioAppointment created: ${physioAppt._id} for doctor: ${doctor_id}`);
 
//     // ── Step 5: Create Razorpay Order ───────────────────────────────────────
//     const currencyUpper = String(currency).toUpperCase();
//     const amountPaise   = Math.round(Number(amount) * 100);
 
//     const order = await razorpay.orders.create({
//       amount:   amountPaise,
//       currency: currencyUpper,
//       receipt:  `cb-${bookingId.slice(-16)}`,
//       notes: {
//         clinicBookingId: bookingId,
//         physioApptId:    physioAppt._id.toString(),
//         patientName,
//         concern:         concern || sessionType,
//       },
//     });
 
//     // ── Step 6: Save Payment document ──────────────────────────────────────
//     const paymentDoc = new Payment({
//       appointmentId: physioAppt._id,
//       amount:        amountPaise,
//       currency:      currencyUpper,
//       referenceId:   order.receipt,
//       purpose:       `${sessionType} – ${concern || "Consultation"} (${patientName})`,
//       customer: {
//         name:    patientName,
//         contact: patientPhone,
//         email:   patientEmail || null,
//       },
//       status: "created",
//       raw:    { razorpay_order: order, clinicBookingId: bookingId, physioApptId: physioAppt._id },
//     });
//     await paymentDoc.save();
 
//     // ── Step 7: Link payment back into booking and physioAppt ───────────────
//     booking.payment = {
//       paymentDocId: paymentDoc._id,
//       linkId:       order.id,
//       referenceId:  order.receipt,
//       amount:       amountPaise,
//       currency:     currencyUpper,
//       status:       "created",
//     };
//     await booking.save();
 
//     physioAppt.payment_doc_id = paymentDoc._id;
//     await physioAppt.save();
 
//     return res.status(201).json({
//       success:             true,
//       appointmentId:       bookingId,
//       physioAppointmentId: physioAppt._id,
//       orderId:             order.id,
//       amount:              amountPaise,
//       currency:            currencyUpper,
//       keyId:               process.env.RAZORPAY_KEY_ID?.trim(),
//     });
 
//   } catch (err) {
//     console.error("POST /create-order error:", err);
//     return res.status(500).json({
//       success: false,
//       message: "Server error creating order",
//       error:   String(err?.message || err),
//     });
//   }
// });
 

//  
//  
// // ─────────────────────────────────────────────────────────────────────────────
// // POST /api/clinics/new-bookings/verify-payment
// // Called by frontend after Razorpay handler fires (payment success)
// // Verifies HMAC signature → marks booking confirmed → sends WhatsApp
// // ─────────────────────────────────────────────────────────────────────────────
// // ─────────────────────────────────────────────────────────────────────────────
// // POST /api/clinics/new-bookings/verify-payment
// // Called by frontend after Razorpay handler fires (payment success)
// // Verifies HMAC signature → marks booking confirmed → creates Twilio room
// // → sends WhatsApp to both patient and doctor
// // ─────────────────────────────────────────────────────────────────────────────
// router.post("/verify-payment", async (req, res) => {
//   try {
//     const {
//       appointmentId,
//       physioAppointmentId,
//       razorpay_order_id,
//       razorpay_payment_id,
//       razorpay_signature,
//       sendWhatsApp = true,
//     } = req.body || {};

//     console.log("🔍 verify-payment received:", { appointmentId, physioAppointmentId, razorpay_order_id });

//     if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
//       return res.status(400).json({ success: false, message: "Missing Razorpay payment fields" });
//     }

//     // ── 1. Verify Razorpay HMAC signature ───────────────────────────────────
//     const secret   = process.env.RAZORPAY_KEY_SECRET?.trim();
//     const body     = `${razorpay_order_id}|${razorpay_payment_id}`;
//     const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");
//     if (expected !== razorpay_signature) {
//       return res.status(400).json({ success: false, message: "Payment signature verification failed" });
//     }

//     // ── 2. Update ClinicBooking ─────────────────────────────────────────────
//     const booking = await ClinicBooking.findById(appointmentId);
//     if (!booking) {
//       return res.status(404).json({ success: false, message: "Booking not found" });
//     }

//     booking.status         = "confirmed";
//     booking.payment.status = "paid";
//     booking.payment.paidAt = new Date();
//     await booking.save();

//     // ── 2b. Update Patient profile with details entered during booking ──────
// try {
//   const patientPhone10 = String(booking.patientPhone).replace(/\D/g, "").replace(/^91/, "").slice(-10);

//   const patientUpdates = {
//     $inc: { total_bookings: 1 },
//   };
//   const setFields = {};
//   if (booking.patientName)  setFields.name   = booking.patientName;
//   if (booking.patientEmail) setFields.email  = booking.patientEmail;
//   if (booking.patientAge)   setFields.age    = booking.patientAge;
//   setFields.profile_complete = true;

//   patientUpdates.$set = setFields;

//   await Patient.findOneAndUpdate(
//     { phone_number: patientPhone10 },
//     patientUpdates,
//     { upsert: true, new: true }
//   );

//   console.log(`✅ Patient profile updated for ${patientPhone10}`);
// } catch (patErr) {
//   console.warn("⚠️ Patient profile update failed (non-fatal):", patErr.message);
// }



//     // ── 3. Update Payment document ──────────────────────────────────────────
//     if (booking.payment?.paymentDocId) {
//       await Payment.findByIdAndUpdate(booking.payment.paymentDocId, {
//         $set: {
//           status:              "paid",
//           razorpay_payment_id,
//           razorpay_order_id,
//           razorpay_signature,
//           paidAt:              new Date(),
//         },
//       }).catch(e => console.warn("Payment doc update failed:", e.message));
//     }

//     // ── 4. Create Twilio room (best-effort) ─────────────────────────────────
//     const roomName = `physio_${uuidv4()}`;
//     let roomSid = null;

//     try {
//       const twilio       = require("twilio");
//       const twilioClient = twilio(
//         process.env.TWILIO_API_KEY_SID,
//         process.env.TWILIO_API_KEY_SECRET,
//         { accountSid: process.env.TWILIO_ACCOUNT_SID }
//       );
//       const room = await twilioClient.video.v1.rooms.create({
//         uniqueName: roomName,
//         type:       "group",
//         recordParticipantsOnConnect: false,
//       });
//       roomSid = room.sid;
//       console.log(`✅ Twilio room created: ${roomName}`);
//     } catch (twErr) {
//       console.warn("⚠️ Twilio room pre-create failed (non-fatal):", twErr?.message || twErr);
//     }

//     const FRONTEND_URL = (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/$/, "");
//     const patientLink  = `${FRONTEND_URL}/consult/${roomName}`;

//     // ── 5. Look up Doctor for phone number + doctor link params ─────────────
//     let doctorDoc   = null;
//     let doctorPhone = null;

//     try {
//       if (physioAppointmentId) {
//         const physioForDoctor = await PhysioAppointment.findById(physioAppointmentId)
//           .select("doctor_id doctor_ref")
//           .lean();

//         // Try ObjectId ref first (most reliable)
//         if (physioForDoctor?.doctor_ref) {
//           doctorDoc = await Doctor.findById(physioForDoctor.doctor_ref)
//             .select("_id doctor_id name phone_number")
//             .lean();
//         }
//         // Fallback: look up by doctor_id string ("doc_001")
//         if (!doctorDoc && physioForDoctor?.doctor_id) {
//           doctorDoc = await Doctor.findOne({ doctor_id: physioForDoctor.doctor_id })
//             .select("_id doctor_id name phone_number")
//             .lean();
//         }
//       }

//       if (doctorDoc) {
//         doctorPhone = doctorDoc.phone_number; // 10-digit
//         console.log(`✅ Doctor resolved: ${doctorDoc.doctor_id} → ${doctorPhone}`);
//       } else {
//         console.warn("⚠️ Doctor document not found — doctor WA will be skipped");
//       }
//     } catch (docErr) {
//       console.warn("Doctor lookup failed (non-fatal):", docErr.message);
//     }

//     // Build doctor link with identity params (matches your working appointment flow)
//     const doctorName = doctorDoc?.name || booking.doctorName || "Doctor";
//     const doctorLink = doctorDoc
//       ? `${FRONTEND_URL}/doctor/join/${roomName}?doctorId=${doctorDoc._id}&doctorUsername=${encodeURIComponent(doctorName)}`
//       : `${FRONTEND_URL}/doctor/join/${roomName}`;

//     console.log("🔗 Links:", { patientLink, doctorLink });

//     // ── 6. Update PhysioAppointment with room + payment info ────────────────
//     if (physioAppointmentId) {
//       const updated = await PhysioAppointment.findByIdAndUpdate(
//         physioAppointmentId,
//         {
//           $set: {
//             status:             "confirmed",
//             razorpay_order_id,
//             razorpay_payment_id,
//             twilio_room_name:   roomName,
//             twilio_room_sid:    roomSid,
//             patient_link:       patientLink,
//             doctor_link:        doctorLink,
//           },
//         },
//         { new: true }
//       );
//       if (updated) {
//         console.log("✅ PhysioAppointment confirmed:", updated._id);
//       } else {
//         console.warn("⚠️ PhysioAppointment not found for id:", physioAppointmentId);
//       }
//     } else {
//       console.warn("⚠️ physioAppointmentId missing — skipping PhysioAppointment update");
//     }

//     const moment = require("moment-timezone");
//     const TZ     = "Asia/Kolkata";

//     let displayTime = booking.time || "";
//     try {
//       if (booking.date && booking.time) {
//         const dateStrIST = moment(booking.date).tz(TZ).format("YYYY-MM-DD");
//         const dt = moment.tz(`${dateStrIST} ${booking.time}`, "YYYY-MM-DD h:mm A", TZ);
//         if (dt.isValid()) {
//           displayTime = dt.format("h:mm A [on] DD MMM YYYY");
//         }
//       }
//     } catch {}

//     const patientName = booking.patientName || "Patient";

//     // ── 7. WhatsApp notifications (best-effort, non-blocking) ───────────────
//     if (sendWhatsApp) {
    

//       // ── 7a. Patient ─────────────────────────────────────────────────────
//       if (booking.patientPhone) {
//         try {
//           await sendTemplateMessage({
//             to:           booking.patientPhone,   // already "91XXXXXXXXXX" from create-order
//             templateName: "patient_appointment_with_time",
//             language:     "en",
//             params: [
//               patientName,
//               doctorName,
//               displayTime,
//               patientLink,
//             ],
//           });
//           console.log(`✅ Patient WA sent → ${booking.patientPhone}`);
//         } catch (waErr) {
//           console.error("❌ Patient WA failed:", waErr?.response?.data || waErr.message);
//         }
//       }

//       // ── 7b. Doctor ──────────────────────────────────────────────────────
//       if (doctorPhone) {
//         try {
//           await sendTemplateMessage({
//             to:           `91${doctorPhone}`,     // normalize 10-digit → "91XXXXXXXXXX"
//             templateName: "twilio_doctor_with_time_new",
//             language:     "en",
//             params: [
//               doctorName,
//               patientName,
//               displayTime,
//               doctorLink,
//             ],
//           });
//           console.log(`✅ Doctor WA sent → 91${doctorPhone}`);
//         } catch (waErr) {
//           console.error("❌ Doctor WA failed:", waErr?.response?.data || waErr.message);
//         }
//       } else {
//         console.warn("⚠️ Doctor phone not resolved — doctor WA skipped");
//       }
//     }

//     // ── 7c. FCM push notification to doctor (new booking confirmed) ─────────
//     if (physioAppointmentId) {
//       try {
//         const { sendNotificationToDoctor } = require("./notification");

//         const physioForPush = await PhysioAppointment.findById(physioAppointmentId)
//           .select("doctor_id date time patient_name concern session_type")
//           .lean();

//         if (physioForPush?.doctor_id) {
//           const pushResult = await sendNotificationToDoctor(physioForPush.doctor_id, {
//             title: "New appointment booked",
//             body:  `${physioForPush.patient_name || "Patient"} · ${physioForPush.concern || "Consultation"} · ${displayTime}`,
//             data: {
//               type:          "new_booking",
//               appointmentId: physioAppointmentId.toString(),
//               date:          physioForPush.date || "",
//               time:          physioForPush.time || "",
//               session_type:  physioForPush.session_type || "",
//             },
//           });

//           if (pushResult.success) {
//             console.log(`✅ Booking push sent → ${physioForPush.doctor_id}`);
//           } else {
//             console.warn(`⚠️ Booking push not sent (${pushResult.reason}) → ${physioForPush.doctor_id}`);
//           }
//         } else {
//           console.warn("⚠️ No doctor_id on PhysioAppointment — skipping booking push");
//         }
//       } catch (pushErr) {
//         console.error("❌ Booking push failed (non-fatal):", pushErr.message);
//       }
//     }
    
//     // ── 8. Return success ───────────────────────────────────────────────────
//     return res.json({
//       success:             true,
//       bookingId:           booking._id,
//       physioAppointmentId: physioAppointmentId || null,
//       twilioRoom: {
//         roomName,
//         roomSid,
//         patientLink,
//         doctorLink,
//       },
//     });

//   } catch (err) {
//     console.error("POST /verify-payment error:", err);
//     return res.status(500).json({
//       success: false,
//       message: "Server error during payment verification",
//       error:   String(err?.message || err),
//     });
//   }
// });




// // GET /api/clinics/new-bookings/appointments?doctor_id=doc_002&status=confirmed
// // router.get("/appointments", async (req, res) => {
// //   try {
// //     const {
// //       doctor_id,
// //       status   = "confirmed",
// //       page     = 1,
// //       limit    = 20,
// //       fromDate = null,
// //       toDate   = null,
// //     } = req.query;  // ← all from query now

// //     if (!doctor_id) {
// //       return res.status(400).json({ success: false, message: "doctor_id is required" });
// //     }

// //     const filter = { doctor_id };

// //     if (status && status !== "all") {
// //       filter.status = status;
// //     }

// //     if (fromDate || toDate) {
// //       filter.date = {};
// //       if (fromDate) filter.date.$gte = fromDate;
// //       if (toDate)   filter.date.$lte = toDate;
// //     }

// //     const pageNum  = Math.max(1, parseInt(page, 10));
// //     const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
// //     const skip     = (pageNum - 1) * limitNum;

// //     const [appointments, total] = await Promise.all([
// //       PhysioAppointment.find(filter)
// //         .sort({ booked_at: -1 })
// //         .skip(skip)
// //         .limit(limitNum)
// //         .lean(),
// //       PhysioAppointment.countDocuments(filter),
// //     ]);

// //     return res.json({
// //       success: true,
// //       total,
// //       page:       pageNum,
// //       limit:      limitNum,
// //       totalPages: Math.ceil(total / limitNum),
// //       appointments,
// //     });

// //   } catch (err) {
// //     console.error("GET /appointments error:", err);
// //     return res.status(500).json({
// //       success: false,
// //       message: "Failed to fetch appointments",
// //       error:   String(err?.message || err),
// //     });
// //   }
// // });

// // ────────────────────────────────────────────────────────────────────────────

// module.exports = router;


// routes/clinicBookingRoutesnew.js
// Mounted at: app.use("/api/clinic-bookings", clinicBookingRoutes)

const express   = require("express");
const router    = express.Router();
const Razorpay  = require("razorpay");
const { v4: uuidv4 } = require("uuid");
const ClinicBooking = require("../Models/ClinicBookingModel");
const Payment       = require("../Models/Payment");
const { sendTemplateMessage, sendConsentFormMessage  } = require("../utils/superfone");
const crypto = require("crypto"); // add at top of file if not already there
const PhysioAppointment = require("../Models/PhysioAppointment");
const Doctor = require("../Models/Doctor"); // to look up doctor_id from booking
const multer = require("multer");
const { uploadToDriveOAuth } = require("../lib/drive-oauth");
const { verifyDoctorToken }  = require("./doctorOtpAuth");
const Patient = require("../Models/Patient");
const Assessment = require("../Models/Assessment");

// ── Ordinal helper (module-level, reusable) ──────────────────────────────────
function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

// ── Twilio room creator (reusable) ───────────────────────────────────────────
async function createTwilioRoom() {
  const roomName = `physio_${uuidv4()}`;
  let roomSid = null;
  try {
    const twilio = require("twilio");
    const twilioClient = twilio(
      process.env.TWILIO_API_KEY_SID,
      process.env.TWILIO_API_KEY_SECRET,
      { accountSid: process.env.TWILIO_ACCOUNT_SID }
    );
    const room = await twilioClient.video.v1.rooms.create({
      uniqueName: roomName,
      type: "group",
      recordParticipantsOnConnect: false,
    });
    roomSid = room.sid;
  } catch (twErr) {
    console.warn("⚠️ Twilio room create failed (non-fatal):", twErr?.message || twErr);
  }
  return { roomName, roomSid };
}


const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    const allowed = [
      "audio/mpeg", "audio/mp3", "audio/mp4",
      "audio/webm", "audio/ogg", "audio/wav", "audio/x-m4a"
    ];
    allowed.includes(file.mimetype)
      ? cb(null, true)
      : cb(new Error("Only audio files are allowed"));
  },
});


// near trimmedEnv/resolveCurrency at the top of the file
function normalizePhone(phone) {
  if (!phone) return "";
  let s = String(phone).replace(/\D/g, "");
  if (s.length === 10) s = "91" + s;
  return s;
}


// ── Razorpay instance (reuse trimmed keys pattern from paymentRoutes) ─────────
function trimmedEnv(key) {
  const v = process.env[key];
  return (typeof v === "string" ? v.trim() : null) || null;
}
const razorpay = new Razorpay({
  key_id:     trimmedEnv("RAZORPAY_KEY_ID")     || "",
  key_secret: trimmedEnv("RAZORPAY_KEY_SECRET") || "",
});

// ── Supported checkout currencies and their smallest-unit multiplier ─────────
// Razorpay amounts are always in the smallest currency unit
// (paise for INR, cents for USD, etc.) — both use a 100x multiplier here.
const SUPPORTED_CURRENCIES = {
  INR: { multiplier: 100 },
  USD: { multiplier: 100 },
};

function resolveCurrency(currency) {
  const code = String(currency || "INR").toUpperCase();
  return SUPPORTED_CURRENCIES[code] ? code : "INR";
}


router.post(
  "/appointments/session-notes",
  verifyDoctorToken,
  audioUpload.single("voice_note"),
  async (req, res) => {
    try {
      const { id } = req.query;  // ← from ?id=...

      if (!id) {
        return res.status(400).json({ success: false, message: "id query parameter is required" });
      }

      // ── Fetch appointment ───────────────────────────────────────────────
      const appt = await PhysioAppointment.findById(id);
      if (!appt) {
        return res.status(404).json({ success: false, message: "Appointment not found" });
      }

      // ── Verify doctor owns this appointment ─────────────────────────────
      if (appt.doctor_id !== req.doctor.doctor_id) {
        return res.status(403).json({
          success: false,
          message: "You are not authorized to update this appointment",
        });
      }

      // ── Build update object ─────────────────────────────────────────────
      const updates = {
        session_notes_saved_at: new Date(),
      };

      if (req.body.notes !== undefined) {
        updates.session_notes = req.body.notes.trim() || null;
      }

      // ── Upload voice note to Google Drive if provided ───────────────────
      if (req.file) {
        try {
          const filename = `session_voice_${id}_${Date.now()}_${req.file.originalname}`;
          const result   = await uploadToDriveOAuth(
            req.file.buffer,
            filename,
            req.file.mimetype
          );
          updates.session_voice_note =
            result?.webViewLink ||
            (result?.id ? `https://drive.google.com/file/d/${result.id}/view` : null);

          console.log(`✅ Session voice note uploaded: ${updates.session_voice_note}`);
        } catch (driveErr) {
          console.error("Drive upload failed:", driveErr.message);
          return res.status(500).json({
            success: false,
            message: "Voice note upload to Drive failed",
            error:   driveErr.message,
          });
        }
      }

      // ── Nothing to save? ────────────────────────────────────────────────
      if (!updates.session_notes && !updates.session_voice_note) {
        return res.status(400).json({
          success: false,
          message: "Provide at least one of: notes (text) or voice_note (audio file)",
        });
      }

      // ── Save to DB ──────────────────────────────────────────────────────
      const updated = await PhysioAppointment.findByIdAndUpdate(
        id,
        { $set: updates },
        { new: true }
      );

      return res.json({
        success: true,
        message: "Session notes saved",
        appointment: {
          id:                     updated._id,
          session_notes:          updated.session_notes,
          session_voice_note:     updated.session_voice_note,
          session_notes_saved_at: updated.session_notes_saved_at,
        },
      });

    } catch (err) {
      console.error("POST /session-notes error:", err);
      return res.status(500).json({
        success: false,
        message: "Server error saving session notes",
        error:   String(err?.message || err),
      });
    }
  }
);



// GET /api/clinics/new-bookings/appointments?doctor_id=doc_002&status=confirmed
// router.get("/appointments", async (req, res) => {
//   try {
//     const {
//       doctor_id,
//       status   = "confirmed",
//       page     = 1,
//       limit    = 20,
//       fromDate = null,
//       toDate   = null,
//     } = req.query;  // ← all from query now

//     if (!doctor_id) {
//       return res.status(400).json({ success: false, message: "doctor_id is required" });
//     }

//     const filter = { doctor_id };

//     if (status && status !== "all") {
//       filter.status = status;
//     }

//     if (fromDate || toDate) {
//       filter.date = {};
//       if (fromDate) filter.date.$gte = fromDate;
//       if (toDate)   filter.date.$lte = toDate;
//     }

//     const pageNum  = Math.max(1, parseInt(page, 10));
//     const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
//     const skip     = (pageNum - 1) * limitNum;

//     const [appointments, total] = await Promise.all([
//       PhysioAppointment.find(filter)
//         .sort({ booked_at: -1 })
//         .skip(skip)
//         .limit(limitNum)
//         .lean(),
//       PhysioAppointment.countDocuments(filter),
//     ]);

//     return res.json({
//       success: true,
//       total,
//       page:       pageNum,
//       limit:      limitNum,
//       totalPages: Math.ceil(total / limitNum),
//       appointments,
//     });

//   } catch (err) {
//     console.error("GET /appointments error:", err);
//     return res.status(500).json({
//       success: false,
//       message: "Failed to fetch appointments",
//       error:   String(err?.message || err),
//     });
//   }
// });

// GET /api/clinics/new-bookings/appointments?token=...&status=confirmed
router.get("/appointments", verifyDoctorToken, async (req, res) => {
  try {
    const {
      status   = "confirmed",
      page     = 1,
      limit    = 20,
      fromDate = null,
      toDate   = null,
    } = req.query;

    // 🔒 doctor_id comes from the verified token, never from the query string
    const doctor_id = req.doctor.doctor_id;

    const filter = { doctor_id };

    if (status && status !== "all") {
      filter.status = status;
    }

    if (fromDate || toDate) {
      filter.date = {};
      if (fromDate) filter.date.$gte = fromDate;
      if (toDate)   filter.date.$lte = toDate;
    }

    const pageNum  = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const skip     = (pageNum - 1) * limitNum;

    const [appointments, total] = await Promise.all([
      PhysioAppointment.find(filter)
        .sort({ booked_at: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      PhysioAppointment.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      total,
      page:       pageNum,
      limit:      limitNum,
      totalPages: Math.ceil(total / limitNum),
      appointments,
    });

  } catch (err) {
    console.error("GET /appointments error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch appointments",
      error:   String(err?.message || err),
    });
  }
});




// ─────────────────────────────────────────────────────────────────────────────
// POST /api/clinic-bookings
// 1. Save ClinicBooking document
// 2. Create Razorpay payment link
// 3. Save Payment document
// 4. Embed payment info back into ClinicBooking
// 5. Send WhatsApp (best-effort)
// Returns: { success, appointmentId, payment: { shortUrl, linkId } }
// ─────────────────────────────────────────────────────────────────────────────
router.post("/", async (req, res) => {
  try {
    const {
      clinicId,
      doctorName,
      clinicName,
      sessionType = "In-clinic",
      date,
      time,
      patientName,
      patientPhone,
      patientEmail = "",
      patientAge   = "",
      concern      = "",
      notes        = "",
      amount,                   // consultation fee in rupees (e.g. 499)
      currency     = "INR",
      sendWhatsApp = true,
      assignedBy   = null,
    } = req.body || {};

    // ── Basic validation ────────────────────────────────────────────────────
    if (!clinicId) {
      return res.status(400).json({ success: false, message: "clinicId is required" });
    }
    if (!patientName || !patientPhone) {
      return res.status(400).json({ success: false, message: "patientName and patientPhone are required" });
    }
    if (amount === undefined || amount === null || Number(amount) <= 0) {
      return res.status(400).json({ success: false, message: "amount (consultation fee) is required" });
    }

    // ── Step 1: Save ClinicBooking ──────────────────────────────────────────
    const booking = new ClinicBooking({
      clinicId,
      doctorName,
      clinicName,
      sessionType,
      date,
      time,
      patientName,
      patientPhone,
      patientEmail,
      patientAge,
      concern,
      notes,
      status: "payment_initiated",
    });
    await booking.save();

    const bookingId = booking._id.toString();

    // ── Step 2: Prepare Razorpay link ───────────────────────────────────────
    const currencyUpper  = resolveCurrency(currency);
    const multiplier     = SUPPORTED_CURRENCIES[currencyUpper].multiplier;
    const amountSmallest = Math.round(Number(amount) * multiplier);

    // reference_id: compact, <= 40 chars
    const shortSuffix = uuidv4().split("-")[0];                    // 8 chars
    let referenceId   = `cb-${bookingId.slice(-16)}-${shortSuffix}`;
    if (referenceId.length > 40) referenceId = referenceId.slice(0, 40);

    const description = `${sessionType} – ${concern || "Consultation"} (${patientName})`;

    // ── Step 3: Save Payment document (before calling Razorpay) ────────────
    const paymentDoc = new Payment({
      appointmentId: bookingId,          // store booking _id here
      amount:        amountSmallest,
      currency:      currencyUpper,
      referenceId,
      purpose:       description,
      customer: {
        name:    patientName,
        contact: patientPhone,
        email:   patientEmail || null,
      },
      status: "created",
      raw:    { createdBy: "clinic-booking", clinicBookingId: bookingId },
    });
    await paymentDoc.save();

    // ── Step 4: Create Razorpay payment link ────────────────────────────────
    const rzpPayload = {
      amount:         amountSmallest,
      currency:       currencyUpper,
      accept_partial: false,
      reference_id:   referenceId,
      description,
      customer: {
        name:    patientName,
        contact: patientPhone.toString().replace(/\D/g, ""),
        email:   patientEmail || "",
      },
      notify:          { sms: false, email: false },
      callback_url:    process.env.FRONTEND_URL
                         ? `${process.env.FRONTEND_URL}/clinic/booking-success`
                         : "",
      callback_method: "get",
    };

    let link;
    try {
      link = await razorpay.paymentLink.create(rzpPayload);
    } catch (rzpErr) {
      console.error("Razorpay create-link error:", rzpErr?.error || rzpErr);
      // Still return the booking ID so the frontend can retry payment later
      paymentDoc.raw = { ...paymentDoc.raw, razorpay_error: rzpErr };
      await paymentDoc.save().catch(() => {});
      return res.status(rzpErr.statusCode || 500).json({
        success: false,
        message: "Booking saved but payment link creation failed",
        appointmentId: bookingId,
        error: rzpErr?.error || String(rzpErr),
      });
    }

    // ── Step 5: Persist link info ───────────────────────────────────────────
    paymentDoc.linkId       = link.id;
    paymentDoc.linkShortUrl = link.short_url || null;
    paymentDoc.linkLongUrl  = link.long_url  || null;
    paymentDoc.raw          = { ...paymentDoc.raw, razorpay_link: link };
    await paymentDoc.save();

    // Embed payment summary into ClinicBooking
    booking.payment = {
      paymentDocId: paymentDoc._id,
      linkId:       link.id,
      shortUrl:     link.short_url || null,
      referenceId,
      amount:       amountSmallest,
      currency:     currencyUpper,
      status:       "created",
    };
    await booking.save();

    // ── Step 6: WhatsApp confirmation (best-effort) ─────────────────────────
    if (sendWhatsApp && patientPhone) {
      try {
        const displayAmt  = (amountSmallest / multiplier).toFixed(2);
        const amtDisplay  = currencyUpper === "INR" ? displayAmt : `${currencyUpper} ${displayAmt}`;
        const paymentLink = link.short_url || link.long_url || "";

        await sendTemplateMessage({
          to:           patientPhone,
          templateName: process.env.SUPERFONE_PAYMENT_TEMPLATE || "payment_getting",
          language:     "en",
          params: [
            patientName,
            concern || sessionType || "clinic session",
            amtDisplay,
            paymentLink,
            assignedBy || doctorName || "Doctor",
          ],
        });
        console.log("✅ WhatsApp sent to:", patientPhone);
      } catch (waErr) {
        console.error("❌ WhatsApp send error:", waErr.message || waErr);
        // non-fatal — continue
      }
    }

    // ── Final response ──────────────────────────────────────────────────────
    return res.status(201).json({
      success:       true,
      appointmentId: bookingId,
      booking:       booking,
      payment: {
        linkId:    link.id,
        shortUrl:  link.short_url  || null,
        longUrl:   link.long_url   || null,
        referenceId,
      },
    });

  } catch (err) {
    console.error("POST /api/clinic-bookings error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error creating clinic booking",
      error:   String(err?.message || err),
    });
  }
});


router.get("/booked-slots", async (req, res) => {
  try {
    const { clinicId, date } = req.query;

    if (!clinicId || !date) {
      return res.status(400).json({ success: false, message: "clinicId and date are required" });
    }

    const mongoose = require("mongoose");

    // Match either by doctor_ref (Mongo ObjectId) or doctor_id string fallback
    const doctorFilter = mongoose.Types.ObjectId.isValid(clinicId)
      ? { $or: [{ doctor_ref: clinicId }, { doctor_id: clinicId }] }
      : { doctor_id: clinicId };

    const PENDING_LOCK_MINUTES = 15;
    const pendingCutoff = new Date(Date.now() - PENDING_LOCK_MINUTES * 60 * 1000);

    const filter = {
      date,
      $and: [
        doctorFilter,
        {
          $or: [
            { status: "confirmed" },
            { status: "pending_payment", booked_at: { $gte: pendingCutoff } },
          ],
        },
      ],
    };

    const appointments = await PhysioAppointment.find(filter)
      .select("time status")
      .lean();

    const bookedTimes = appointments.map(a => a.time).filter(Boolean);

    return res.json({ success: true, bookedTimes });

  } catch (err) {
    console.error("GET /booked-slots error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch booked slots",
      error: String(err?.message || err),
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/clinic-bookings/:id
// Fetch a single clinic booking by ID
// ─────────────────────────────────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  try {
    const booking = await ClinicBooking.findById(req.params.id).lean();
    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found" });
    }
    return res.json({ success: true, booking });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error", error: String(err) });
  }
});




// ─────────────────────────────────────────────────────────────────────────────
// GET /api/clinic-bookings/clinic/:clinicId
// List all bookings for a clinic (newest first)
// ─────────────────────────────────────────────────────────────────────────────
router.get("/clinic/:clinicId", async (req, res) => {
  try {
    const { status, limit = 50, skip = 0 } = req.query;
    const query = { clinicId: req.params.clinicId };
    if (status) query.status = status;

    const bookings = await ClinicBooking
      .find(query)
      .sort({ createdAt: -1 })
      .skip(Number(skip))
      .limit(Number(limit))
      .lean();

    const total = await ClinicBooking.countDocuments(query);

    return res.json({ success: true, total, bookings });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error", error: String(err) });
  }
});


// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/clinic-bookings/:id/status
// Update booking status (e.g. after webhook confirms payment)
// Body: { status: "confirmed" | "cancelled" | "no_show" }
// ─────────────────────────────────────────────────────────────────────────────
router.patch("/:id/status", async (req, res) => {
  try {
    const { status } = req.body || {};
    const allowed = ["pending", "payment_initiated", "confirmed", "cancelled", "no_show"];
    if (!allowed.includes(status)) {
      return res.status(400).json({ success: false, message: `status must be one of: ${allowed.join(", ")}` });
    }

    const booking = await ClinicBooking.findByIdAndUpdate(
      req.params.id,
      { $set: { status } },
      { new: true }
    );
    if (!booking) return res.status(404).json({ success: false, message: "Booking not found" });

    return res.json({ success: true, booking });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Server error", error: String(err) });
  }
});


// ─────────────────────────────────────────────────────────────────────────────
// POST /api/clinic-bookings/webhook/payment-paid
// Called by Razorpay webhook (or from your existing paymentRoutes webhook)
// to mark a clinic booking as confirmed after payment
// Body: { referenceId, razorpayPaymentId }
// ─────────────────────────────────────────────────────────────────────────────
router.post("/webhook/payment-paid", async (req, res) => {
  try {
    const { referenceId, razorpayPaymentId, linkId } = req.body || {};

    let booking = null;

    if (linkId) {
      booking = await ClinicBooking.findOne({ "payment.linkId": linkId });
    }
    if (!booking && referenceId) {
      booking = await ClinicBooking.findOne({ "payment.referenceId": referenceId });
    }

    if (!booking) {
      return res.status(404).json({ success: false, message: "ClinicBooking not found for this payment" });
    }

    booking.status             = "confirmed";
    booking.payment.status     = "paid";
    booking.payment.paidAt     = new Date();
    await booking.save();

    // Also update the Payment document
    if (booking.payment.paymentDocId) {
      await Payment.findByIdAndUpdate(booking.payment.paymentDocId, {
        $set: {
          status:              "paid",
          razorpay_payment_id: razorpayPaymentId || null,
          paidAt:              new Date(),
        },
      }).catch(() => {});
    }

    return res.json({ success: true, bookingId: booking._id });
  } catch (err) {
    console.error("clinic booking webhook error:", err);
    return res.status(500).json({ success: false, message: "Server error", error: String(err) });
  }
});




// ─────────────────────────────────────────────────────────────────────────────
// POST /api/clinics/new-bookings/create-order
// Creates ClinicBooking + PhysioAppointment + Razorpay order
//
// `amount` / `currency` in the request body represent the amount the
// PATIENT is being charged (already converted on the frontend based on
// their detected country — INR for India, USD elsewhere). The original
// INR consultation fee (doctor.session_pricing) is stored separately on
// the PhysioAppointment/ClinicBooking as `amount_paid_inr` for reporting,
// while `amount_paid` / `currency` reflect the actual charged amount.
//
// Returns: { success, appointmentId, physioAppointmentId, orderId, amount, currency, keyId }
// ─────────────────────────────────────────────────────────────────────────────

router.post("/create-order", async (req, res) => {
  try {
    const {
      clinicId,
      doctorName,
      clinicName,
      sessionType  = "In-clinic",
      date,
      time,
      patientName,
      patientPhone,
      patientEmail = "",
      patientAge   = "",
      concern      = "",
      notes        = "",
      amount,
      currency     = "INR",
      assignedBy   = null,
      assessmentId = null,   // ← NEW

    } = req.body || {};
 
    if (!clinicId)                      return res.status(400).json({ success: false, message: "clinicId is required" });
    if (!patientName || !patientPhone)  return res.status(400).json({ success: false, message: "patientName and patientPhone are required" });
    if (!amount || Number(amount) <= 0) return res.status(400).json({ success: false, message: "amount is required" });

    // ── Resolve + validate charge currency ─────────────────────────────────
    const currencyUpper = resolveCurrency(currency);
    const multiplier    = SUPPORTED_CURRENCIES[currencyUpper].multiplier;
    const amountSmallest = Math.round(Number(amount) * multiplier);

    // ── Step 1: Create ClinicBooking ────────────────────────────────────────
    const booking = new ClinicBooking({
      clinicId, doctorName, clinicName,
      sessionType, date, time,
      patientName, patientPhone, patientEmail, patientAge,
      concern, notes,
      status: "payment_initiated",
    });
    await booking.save();
    const bookingId = booking._id.toString();
 
    // ── Step 2: Look up doctor using the top-level Doctor import ───────────
    // clinicId from frontend = doctor MongoDB _id (ObjectId string)
    let doctor_id  = null;
    let doctor_ref = null;
    try {
      const doc = await Doctor.findById(clinicId).lean();
      if (doc) {
        doctor_id  = doc.doctor_id;   // "doc_001"
        doctor_ref = doc._id;
        console.log(`✅ Doctor found: ${doctor_id}`);
      } else {
        console.warn(`⚠️  No Doctor document found for clinicId: ${clinicId}`);
      }
    } catch (e) {
      console.warn("Doctor lookup failed:", e.message);
    }
 
    // ── Step 3: Validate doctor_id before creating PhysioAppointment ───────
    if (!doctor_id) {
      // Fallback: if clinicId itself looks like a doctor_id string (doc_001), use it directly
      if (typeof clinicId === "string" && clinicId.startsWith("doc_")) {
        doctor_id = clinicId;
        console.warn(`⚠️  Using clinicId as doctor_id fallback: ${doctor_id}`);
      } else {
        return res.status(400).json({
          success: false,
          message: `Doctor not found for clinicId: ${clinicId}. Cannot create appointment.`,
        });
      }
    }
 
    // ── Look up patient_id from Patient collection ──
let patient_id = null;
try {
  // const normPhone = String(patientPhone).replace(/\D/g, "").replace(/^91/, "").slice(-10);
  // const patientDoc = await Patient.findOne({ phone_number: normPhone }).lean();
  const normPhone = normalizePhone(patientPhone);
const patientDoc = await Patient.findOne({ phone_number: normPhone }).lean();
  if (patientDoc) patient_id = patientDoc.patient_id;
} catch (e) {
  console.warn("Patient lookup for patient_id failed:", e.message);
}

// ── Build concern label with booking-type suffix ────────────────────────
function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

const bookingType = req.body.bookingType || "single";

const concernSuffix = bookingType === "package"
  ? ` - package ${ordinal(1)} session`   // first session created at order-time is always #1
  : " - single session";

const concernWithSuffix = concern
  ? `${concern}${concernSuffix}`
  : concernSuffix.trim();

  // ── NEW: invoice_description (concern + booking type, for invoicing) ───────
const invoiceLabel = bookingType === "package" ? "package" : "single session";
const invoiceDescription = concern
  ? `${concern} (${invoiceLabel})`
  : `${sessionType || "Consultation"} (${invoiceLabel})`;
  

const sessionCount = Number(req.body.packageSessions) || 1;
const sessionsArray = Array.from({ length: sessionCount }, (_, i) => ({
  session_number: i + 1,
  date:           i === 0 ? (date || null) : null,
  time:           i === 0 ? (time || null) : null,
  patient_link:   null,
  doctor_link:    null,
  status:         "pending",
  booked_at:      i === 0 ? new Date() : null,
}));




    // ── Step 4: Create PhysioAppointment (pending_payment) ─────────────────
    const physioAppt = await PhysioAppointment.create({
      doctor_id,
      doctor_ref:        doctor_ref || undefined,
      patient_id,                         // ← add this
      patient_name:      patientName,
      patient_phone:     patientPhone,
      patient_email:     patientEmail || null,
      patient_age:       patientAge   || null,
      concern:           concernWithSuffix      || null,
      invoice_description: invoiceDescription,   // ← NEW
      session_type:      sessionType,
      date:              date         || null,
      time:              time         || null,
      notes:             notes        || null,
      status:            "pending_payment",
      amount_paid:       amountSmallest,
      currency:          currencyUpper,
      clinic_booking_id: booking._id,
      booking_type:              req.body.bookingType || "single",
      package_sessions:          req.body.packageSessions || 1,
      package_price_per_session: req.body.packagePricePerSession || null,
      package_discount_percent:  req.body.packageDiscountPercent || 0,
      package_total_amount:      req.body.packageTotalAmount || null,
      sessions:                  sessionsArray,
      assessment_id: assessmentId || null,   // ← NEW


    });
    console.log(`✅ PhysioAppointment created: ${physioAppt._id} for doctor: ${doctor_id} | ${currencyUpper} ${amount}`);
 
    // ── Step 5: Create Razorpay Order (in the charge currency) ──────────────
    const order = await razorpay.orders.create({
      amount:   amountSmallest,
      currency: currencyUpper,
      receipt:  `cb-${bookingId.slice(-16)}`,
      notes: {
        clinicBookingId: bookingId,
        physioApptId:    physioAppt._id.toString(),
        patientName,
        concern:         concern || sessionType,
      },
    });
 
    // ── Step 6: Save Payment document ──────────────────────────────────────
    const paymentDoc = new Payment({
      appointmentId: physioAppt._id,
      amount:        amountSmallest,
      currency:      currencyUpper,
      referenceId:   order.receipt,
      purpose:       `${sessionType} – ${concern || "Consultation"} (${patientName})`,
      customer: {
        name:    patientName,
        contact: patientPhone,
        email:   patientEmail || null,
      },
      status: "created",
      raw:    { razorpay_order: order, clinicBookingId: bookingId, physioApptId: physioAppt._id },
    });
    await paymentDoc.save();
 
    // ── Step 7: Link payment back into booking and physioAppt ───────────────
    booking.payment = {
      paymentDocId: paymentDoc._id,
      linkId:       order.id,
      referenceId:  order.receipt,
      amount:       amountSmallest,
      currency:     currencyUpper,
      status:       "created",
    };
    await booking.save();
 
    physioAppt.payment_doc_id = paymentDoc._id;
    await physioAppt.save();
 
    return res.status(201).json({
      success:             true,
      appointmentId:       bookingId,
      physioAppointmentId: physioAppt._id,
      orderId:             order.id,
      amount:              amountSmallest,
      currency:            currencyUpper,
      keyId:               process.env.RAZORPAY_KEY_ID?.trim(),
    });
 
  } catch (err) {
    console.error("POST /create-order error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error creating order",
      error:   String(err?.message || err),
    });
  }
});
 

 
 
// ─────────────────────────────────────────────────────────────────────────────
// POST /api/clinics/new-bookings/verify-payment
// Called by frontend after Razorpay handler fires (payment success)
// Verifies HMAC signature → marks booking confirmed → creates Twilio room
// → sends WhatsApp to both patient and doctor
// ─────────────────────────────────────────────────────────────────────────────
// router.post("/verify-payment", async (req, res) => {
//   try {
//     const {
//       appointmentId,
//       physioAppointmentId,
//       razorpay_order_id,
//       razorpay_payment_id,
//       razorpay_signature,
//       sendWhatsApp = true,
//     } = req.body || {};

//     console.log("🔍 verify-payment received:", { appointmentId, physioAppointmentId, razorpay_order_id });

//     if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
//       return res.status(400).json({ success: false, message: "Missing Razorpay payment fields" });
//     }

//     // ── 1. Verify Razorpay HMAC signature ───────────────────────────────────
//     const secret   = process.env.RAZORPAY_KEY_SECRET?.trim();
//     const body     = `${razorpay_order_id}|${razorpay_payment_id}`;
//     const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");
//     if (expected !== razorpay_signature) {
//       return res.status(400).json({ success: false, message: "Payment signature verification failed" });
//     }

//     // ── 2. Update ClinicBooking ─────────────────────────────────────────────
//     const booking = await ClinicBooking.findById(appointmentId);
//     if (!booking) {
//       return res.status(404).json({ success: false, message: "Booking not found" });
//     }

//     booking.status         = "confirmed";
//     booking.payment.status = "paid";
//     booking.payment.paidAt = new Date();
//     await booking.save();

//     // ── 2b. Update Patient profile with details entered during booking ──────
// try {
//   const normalizedPatientPhone = normalizePhone(booking.patientPhone);

//   const patientUpdates = {
//     $inc: { total_bookings: 1 },
//   };
//   const setFields = {};
//   if (booking.patientName)  setFields.name   = booking.patientName;
//   if (booking.patientEmail) setFields.email  = booking.patientEmail;
//   if (booking.patientAge)   setFields.age    = booking.patientAge;
//   setFields.profile_complete = true;

//   patientUpdates.$set = setFields;

//   await Patient.findOneAndUpdate({ phone_number: normalizedPatientPhone }, patientUpdates, { upsert: true, new: true });


//   console.log(`✅ Patient profile updated for ${patientPhone10}`);
// } catch (patErr) {
//   console.warn("⚠️ Patient profile update failed (non-fatal):", patErr.message);
// }



//     // ── 3. Update Payment document ──────────────────────────────────────────
//     if (booking.payment?.paymentDocId) {
//       await Payment.findByIdAndUpdate(booking.payment.paymentDocId, {
//         $set: {
//           status:              "paid",
//           razorpay_payment_id,
//           razorpay_order_id,
//           razorpay_signature,
//           paidAt:              new Date(),
//         },
//       }).catch(e => console.warn("Payment doc update failed:", e.message));
//     }

//     // ── 4. Create Twilio room (best-effort) ─────────────────────────────────
//     const roomName = `physio_${uuidv4()}`;
//     let roomSid = null;

//     try {
//       const twilio       = require("twilio");
//       const twilioClient = twilio(
//         process.env.TWILIO_API_KEY_SID,
//         process.env.TWILIO_API_KEY_SECRET,
//         { accountSid: process.env.TWILIO_ACCOUNT_SID }
//       );
//       const room = await twilioClient.video.v1.rooms.create({
//         uniqueName: roomName,
//         type:       "group",
//         recordParticipantsOnConnect: false,
//       });
//       roomSid = room.sid;
//       console.log(`✅ Twilio room created: ${roomName}`);
//     } catch (twErr) {
//       console.warn("⚠️ Twilio room pre-create failed (non-fatal):", twErr?.message || twErr);
//     }

//     const FRONTEND_URL = (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/$/, "");
//     const patientLink  = `${FRONTEND_URL}/consult/${roomName}`;

//     // ── 5. Look up Doctor for phone number + doctor link params ─────────────
//     let doctorDoc   = null;
//     let doctorPhone = null;

//     try {
//       if (physioAppointmentId) {
//         const physioForDoctor = await PhysioAppointment.findById(physioAppointmentId)
//           .select("doctor_id doctor_ref")
//           .lean();

//         // Try ObjectId ref first (most reliable)
//         if (physioForDoctor?.doctor_ref) {
//           doctorDoc = await Doctor.findById(physioForDoctor.doctor_ref)
//             .select("_id doctor_id name phone_number")
//             .lean();
//         }
//         // Fallback: look up by doctor_id string ("doc_001")
//         if (!doctorDoc && physioForDoctor?.doctor_id) {
//           doctorDoc = await Doctor.findOne({ doctor_id: physioForDoctor.doctor_id })
//             .select("_id doctor_id name phone_number")
//             .lean();
//         }
//       }

//       if (doctorDoc) {
//         doctorPhone = doctorDoc.phone_number; // 10-digit
//         console.log(`✅ Doctor resolved: ${doctorDoc.doctor_id} → ${doctorPhone}`);
//       } else {
//         console.warn("⚠️ Doctor document not found — doctor WA will be skipped");
//       }
//     } catch (docErr) {
//       console.warn("Doctor lookup failed (non-fatal):", docErr.message);
//     }

//     // Build doctor link with identity params (matches your working appointment flow)
//     const doctorName = doctorDoc?.name || booking.doctorName || "Doctor";
//     const doctorLink = doctorDoc
//       ? `${FRONTEND_URL}/doctor/join/${roomName}?doctorId=${doctorDoc._id}&doctorUsername=${encodeURIComponent(doctorName)}`
//       : `${FRONTEND_URL}/doctor/join/${roomName}`;

//     console.log("🔗 Links:", { patientLink, doctorLink });

//     // ── 6. Update PhysioAppointment with room + payment info ────────────────
//     if (physioAppointmentId) {
//       const updated = await PhysioAppointment.findByIdAndUpdate(
//         physioAppointmentId,
//         {
//           $set: {
//             status:             "confirmed",
//             razorpay_order_id,
//             razorpay_payment_id,
//             twilio_room_name:   roomName,
//             twilio_room_sid:    roomSid,
//             patient_link:       patientLink,
//             doctor_link:        doctorLink,
//           },
//         },
//         { new: true }
//       );
//       if (updated) {
//         console.log("✅ PhysioAppointment confirmed:", updated._id);
//       } else {
//         console.warn("⚠️ PhysioAppointment not found for id:", physioAppointmentId);
//       }
//     } else {
//       console.warn("⚠️ physioAppointmentId missing — skipping PhysioAppointment update");
//     }

//     const moment = require("moment-timezone");
//     const TZ     = "Asia/Kolkata";

//     let displayTime = booking.time || "";
//     try {
//       if (booking.date && booking.time) {
//         const dateStrIST = moment(booking.date).tz(TZ).format("YYYY-MM-DD");
//         const dt = moment.tz(`${dateStrIST} ${booking.time}`, "YYYY-MM-DD h:mm A", TZ);
//         if (dt.isValid()) {
//           displayTime = dt.format("h:mm A [on] DD MMM YYYY");
//         }
//       }
//     } catch {}

//     const patientName = booking.patientName || "Patient";

//     // ── 7. WhatsApp notifications (best-effort, non-blocking) ───────────────
//     if (sendWhatsApp) {
    

//       // ── 7a. Patient ─────────────────────────────────────────────────────
//       if (booking.patientPhone) {
//         try {
//           await sendTemplateMessage({
//             to:           booking.patientPhone,   // already "91XXXXXXXXXX" from create-order
//             templateName: "patient_appointment_with_time",
//             language:     "en",
//             params: [
//               patientName,
//               doctorName,
//               displayTime,
//               patientLink,
//             ],
//           });
//           console.log(`✅ Patient WA sent → ${booking.patientPhone}`);
//         } catch (waErr) {
//           console.error("❌ Patient WA failed:", waErr?.response?.data || waErr.message);
//         }
//       }

//       // ── 7b. Doctor ──────────────────────────────────────────────────────
//       if (doctorPhone) {
//         try {
//           await sendTemplateMessage({
//             to:           `91${doctorPhone}`,     // normalize 10-digit → "91XXXXXXXXXX"
//             templateName: "twilio_doctor_with_time_new",
//             language:     "en",
//             params: [
//               doctorName,
//               patientName,
//               displayTime,
//               doctorLink,
//             ],
//           });
//           console.log(`✅ Doctor WA sent → 91${doctorPhone}`);
//         } catch (waErr) {
//           console.error("❌ Doctor WA failed:", waErr?.response?.data || waErr.message);
//         }
//       } else {
//         console.warn("⚠️ Doctor phone not resolved — doctor WA skipped");
//       }
//     }

//     // ── 7c. FCM push notification to doctor (new booking confirmed) ─────────
//     if (physioAppointmentId) {
//       try {
//         const { sendNotificationToDoctor } = require("./notification");

//         const physioForPush = await PhysioAppointment.findById(physioAppointmentId)
//           .select("doctor_id date time patient_name concern session_type")
//           .lean();

//         if (physioForPush?.doctor_id) {
//           const pushResult = await sendNotificationToDoctor(physioForPush.doctor_id, {
//             title: "New appointment booked",
//             body:  `${physioForPush.patient_name || "Patient"} · ${physioForPush.concern || "Consultation"} · ${displayTime}`,
//             data: {
//               type:          "new_booking",
//               appointmentId: physioAppointmentId.toString(),
//               date:          physioForPush.date || "",
//               time:          physioForPush.time || "",
//               session_type:  physioForPush.session_type || "",
//             },
//           });

//           if (pushResult.success) {
//             console.log(`✅ Booking push sent → ${physioForPush.doctor_id}`);
//           } else {
//             console.warn(`⚠️ Booking push not sent (${pushResult.reason}) → ${physioForPush.doctor_id}`);
//           }
//         } else {
//           console.warn("⚠️ No doctor_id on PhysioAppointment — skipping booking push");
//         }
//       } catch (pushErr) {
//         console.error("❌ Booking push failed (non-fatal):", pushErr.message);
//       }
//     }
    
//     // ── 8. Return success ───────────────────────────────────────────────────
//     return res.json({
//       success:             true,
//       bookingId:           booking._id,
//       physioAppointmentId: physioAppointmentId || null,
//       twilioRoom: {
//         roomName,
//         roomSid,
//         patientLink,
//         doctorLink,
//       },
//     });

//   } catch (err) {
//     console.error("POST /verify-payment error:", err);
//     return res.status(500).json({
//       success: false,
//       message: "Server error during payment verification",
//       error:   String(err?.message || err),
//     });
//   }
// });
router.post("/verify-payment", async (req, res) => {
  try {
    const {
      appointmentId,
      physioAppointmentId,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      sendWhatsApp = true,
      assessmentId = null,   // ← NEW

    } = req.body || {};

    console.log("🔍 verify-payment received:", { appointmentId, physioAppointmentId, razorpay_order_id });

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ success: false, message: "Missing Razorpay payment fields" });
    }

    // ── 1. Verify Razorpay HMAC signature ───────────────────────────────────
    const secret   = process.env.RAZORPAY_KEY_SECRET?.trim();
    const body     = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");
    if (expected !== razorpay_signature) {
      return res.status(400).json({ success: false, message: "Payment signature verification failed" });
    }

    // ── 2. Update ClinicBooking ─────────────────────────────────────────────
    const booking = await ClinicBooking.findById(appointmentId);
    if (!booking) {
      return res.status(404).json({ success: false, message: "Booking not found" });
    }

    booking.status         = "confirmed";
    booking.payment.status = "paid";
    booking.payment.paidAt = new Date();
    await booking.save();

    // ── 3. Update Payment document ──────────────────────────────────────────
    if (booking.payment?.paymentDocId) {
      await Payment.findByIdAndUpdate(booking.payment.paymentDocId, {
        $set: {
          status:              "paid",
          razorpay_payment_id,
          razorpay_order_id,
          razorpay_signature,
          paidAt:              new Date(),
        },
      }).catch(e => console.warn("Payment doc update failed:", e.message));
    }

    // ── Respond immediately — user sees success screen right away ───────────
    res.json({
      success:             true,
      bookingId:           booking._id,
      physioAppointmentId: physioAppointmentId || null,
    });

    // ── All slow tasks run in background after response is sent ─────────────
    setImmediate(async () => {
      try {

        // ── 2b. Update Patient profile ──────────────────────────────────────
        try {
          const normalizedPatientPhone = normalizePhone(booking.patientPhone);
          const patientUpdates = { $inc: { total_bookings: 1 } };
          const setFields = {};
          if (booking.patientName)  setFields.name             = booking.patientName;
          if (booking.patientEmail) setFields.email            = booking.patientEmail;
          if (booking.patientAge)   setFields.age              = booking.patientAge;
          setFields.profile_complete = true;
          patientUpdates.$set = setFields;

          await Patient.findOneAndUpdate(
            { phone_number: normalizedPatientPhone },
            patientUpdates,
            { upsert: true, new: true }
          );
          console.log(`✅ Patient profile updated for ${normalizedPatientPhone}`);
        } catch (patErr) {
          console.warn("⚠️ Patient profile update failed (non-fatal):", patErr.message);
        }

        // ── 4. Create Twilio room ───────────────────────────────────────────
        const roomName = `physio_${uuidv4()}`;
        let roomSid = null;

        try {
          const twilio       = require("twilio");
          const twilioClient = twilio(
            process.env.TWILIO_API_KEY_SID,
            process.env.TWILIO_API_KEY_SECRET,
            { accountSid: process.env.TWILIO_ACCOUNT_SID }
          );
          const room = await twilioClient.video.v1.rooms.create({
            uniqueName: roomName,
            type:       "group",
            recordParticipantsOnConnect: false,
          });
          roomSid = room.sid;
          console.log(`✅ Twilio room created: ${roomName}`);
        } catch (twErr) {
          console.warn("⚠️ Twilio room pre-create failed (non-fatal):", twErr?.message || twErr);
        }

        const FRONTEND_URL = (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/$/, "");
        const patientLink  = `${FRONTEND_URL}/consult/${roomName}`;

        // ── 5. Look up Doctor ───────────────────────────────────────────────
        let doctorDoc   = null;
        let doctorPhone = null;

        try {
          if (physioAppointmentId) {
            const physioForDoctor = await PhysioAppointment.findById(physioAppointmentId)
              .select("doctor_id doctor_ref")
              .lean();

            if (physioForDoctor?.doctor_ref) {
              doctorDoc = await Doctor.findById(physioForDoctor.doctor_ref)
                .select("_id doctor_id name phone_number")
                .lean();
            }
            if (!doctorDoc && physioForDoctor?.doctor_id) {
              doctorDoc = await Doctor.findOne({ doctor_id: physioForDoctor.doctor_id })
                .select("_id doctor_id name phone_number")
                .lean();
            }
          }

          if (doctorDoc) {
            doctorPhone = doctorDoc.phone_number;
            console.log(`✅ Doctor resolved: ${doctorDoc.doctor_id} → ${doctorPhone}`);
          } else {
            console.warn("⚠️ Doctor document not found — doctor WA will be skipped");
          }
        } catch (docErr) {
          console.warn("Doctor lookup failed (non-fatal):", docErr.message);
        }

        const doctorName = doctorDoc?.name || booking.doctorName || "Doctor";
        const doctorLink = doctorDoc
          ? `${FRONTEND_URL}/doctor/join/${roomName}?doctorId=${doctorDoc._id}&doctorUsername=${encodeURIComponent(doctorName)}`
          : `${FRONTEND_URL}/doctor/join/${roomName}`;

        console.log("🔗 Links:", { patientLink, doctorLink });

        // ── 6. Update PhysioAppointment with room + payment info ────────────
     // ── 6. Update PhysioAppointment with room + payment info ────────────────────
// For package bookings, also write the links into sessions[0].
if (physioAppointmentId) {
  const apptToUpdate = await PhysioAppointment.findById(physioAppointmentId);
  if (apptToUpdate) {
    apptToUpdate.status             = "confirmed";
    apptToUpdate.razorpay_order_id  = razorpay_order_id;
    apptToUpdate.razorpay_payment_id = razorpay_payment_id;
    apptToUpdate.twilio_room_name   = roomName;
    apptToUpdate.twilio_room_sid    = roomSid;
    apptToUpdate.patient_link       = patientLink;
    apptToUpdate.doctor_link        = doctorLink;

    
    // Backfill sessions[0] with the Twilio links now that we have them
    if (apptToUpdate.sessions && apptToUpdate.sessions.length > 0) {
      apptToUpdate.sessions[0].patient_link = patientLink;
      apptToUpdate.sessions[0].doctor_link  = doctorLink;
      apptToUpdate.sessions[0].status       = "confirmed";
      apptToUpdate.markModified("sessions"); // required for Mongoose to detect array changes
    }

    await apptToUpdate.save();


  // ── NEW: write booking info back onto the Assessment ──────────────
    const linkedAssessmentId = assessmentId || apptToUpdate.assessment_id;
    if (linkedAssessmentId) {
      try {
        await Assessment.findByIdAndUpdate(linkedAssessmentId, {
          $set: {
            booking: {
              physioAppointmentId: apptToUpdate._id,
              clinicBookingId: booking._id,
              doctorId: apptToUpdate.doctor_id,
              doctorName,
              sessionType: apptToUpdate.booking_type,
              packageSessions: apptToUpdate.package_sessions,
              amount: apptToUpdate.amount_paid,
              currency: apptToUpdate.currency,
              status: "confirmed",
              bookedAt: new Date(),
            },
          },
        });
        console.log(`✅ Assessment ${linkedAssessmentId} linked to booking ${apptToUpdate._id}`);
      } catch (linkErr) {
        console.warn("⚠️ Assessment booking link failed (non-fatal):", linkErr.message);
      }
    }
  } else {
    console.warn("⚠️ PhysioAppointment not found for id:", physioAppointmentId);
  }
}

        // ── Time formatting ─────────────────────────────────────────────────
        const moment = require("moment-timezone");
        const TZ     = "Asia/Kolkata";

        let displayTime = booking.time || "";
        try {
          if (booking.date && booking.time) {
            const dateStrIST = moment(booking.date).tz(TZ).format("YYYY-MM-DD");
            const dt = moment.tz(`${dateStrIST} ${booking.time}`, "YYYY-MM-DD h:mm A", TZ);
            if (dt.isValid()) {
              displayTime = dt.format("h:mm A [on] DD MMM YYYY");
            }
          }
        } catch {}

        const patientName = booking.patientName || "Patient";

        // ── 7. WhatsApp notifications ───────────────────────────────────────
        if (sendWhatsApp) {

          // 7a. Patient
          if (booking.patientPhone) {
            try {
              await sendTemplateMessage({
                to:           booking.patientPhone,
                templateName: "patient_appointment_with_time",
                language:     "en",
                params:       [patientName, doctorName, displayTime, patientLink],
              });
              console.log(`✅ Patient WA sent → ${booking.patientPhone}`);
            } catch (waErr) {
              console.error("❌ Patient WA failed:", waErr?.response?.data || waErr.message);
            }
          }
// 7a2. Consent form link (separate WA message, best-effort)
if (booking.patientPhone && physioAppointmentId) {
  try {
    const consentLink = `${FRONTEND_URL}/consent/appointment/${physioAppointmentId}`;
    await sendConsentFormMessage({
      to:           booking.patientPhone,
      patientName,
      formLink:     consentLink,
      doctorName,
    });
    console.log(`✅ Consent link WA sent → ${booking.patientPhone}`);
  } catch (waErr) {
    console.error("❌ Consent WA failed:", waErr?.response?.data || waErr.message);
  }
}
          // 7b. Doctor
          if (doctorPhone) {
            try {
              await sendTemplateMessage({
                to:           `91${doctorPhone}`,
                templateName: "twilio_doctor_with_time_new",
                language:     "en",
                params:       [doctorName, patientName, displayTime, doctorLink],
              });
              console.log(`✅ Doctor WA sent → 91${doctorPhone}`);
            } catch (waErr) {
              console.error("❌ Doctor WA failed:", waErr?.response?.data || waErr.message);
            }
          } else {
            console.warn("⚠️ Doctor phone not resolved — doctor WA skipped");
          }
        }

        // ── 7c. FCM push to doctor ──────────────────────────────────────────
        if (physioAppointmentId) {
          try {
            const { sendNotificationToDoctor } = require("./notification");

            const physioForPush = await PhysioAppointment.findById(physioAppointmentId)
              .select("doctor_id date time patient_name concern session_type")
              .lean();

            if (physioForPush?.doctor_id) {
              const pushResult = await sendNotificationToDoctor(physioForPush.doctor_id, {
                title: "New appointment booked",
                body:  `${physioForPush.patient_name || "Patient"} · ${physioForPush.concern || "Consultation"} · ${displayTime}`,
                data: {
                  type:          "new_booking",
                  appointmentId: physioAppointmentId.toString(),
                  date:          physioForPush.date || "",
                  time:          physioForPush.time || "",
                  session_type:  physioForPush.session_type || "",
                },
              });

              if (pushResult.success) {
                console.log(`✅ Booking push sent → ${physioForPush.doctor_id}`);
              } else {
                console.warn(`⚠️ Booking push not sent (${pushResult.reason}) → ${physioForPush.doctor_id}`);
              }
            } else {
              console.warn("⚠️ No doctor_id on PhysioAppointment — skipping booking push");
            }
          } catch (pushErr) {
            console.error("❌ Booking push failed (non-fatal):", pushErr.message);
          }
        }

      } catch (bgErr) {
        console.error("❌ Background post-payment task failed:", bgErr.message);
      }
    }); // end setImmediate

  } catch (err) {
    console.error("POST /verify-payment error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error during payment verification",
      error:   String(err?.message || err),
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/clinics/new-bookings/schedule-session
// Doctor schedules (or reschedules) a follow-up session inside a package
// booking. Updates sessions[sessionNumber] AND mirrors the top-level
// date/time/links to reflect this newly scheduled session.
// Body: { appointmentId, sessionNumber, date, time }
// ─────────────────────────────────────────────────────────────────────────────
router.post("/schedule-session", async (req, res) => {
  try {
    const { appointmentId, sessionNumber, date, time, doctorId } = req.body || {};

    if (!appointmentId || !sessionNumber || !date || !time) {
      return res.status(400).json({
        success: false,
        message: "appointmentId, sessionNumber, date, and time are required",
      });
    }

    const appt = await PhysioAppointment.findById(appointmentId);
    if (!appt) {
      return res.status(404).json({ success: false, message: "Appointment not found" });
    }

    // ── Verify doctor owns this appointment ────────────────────────────────
    if (!doctorId || appt.doctor_id !== doctorId) {
      return res.status(403).json({
        success: false,
        message: "doctorId does not match this appointment",
      });
    }

    if (appt.booking_type !== "package") {
      return res.status(400).json({
        success: false,
        message: "This appointment is not a package booking",
      });
    }

    const idx = appt.sessions.findIndex(s => s.session_number === Number(sessionNumber));
    if (idx === -1) {
      return res.status(400).json({
        success: false,
        message: `Session ${sessionNumber} not found on this booking`,
      });
    }

    // ── Create a fresh Twilio room for this session ────────────────────────
    const { roomName, roomSid } = await createTwilioRoom();

    const FRONTEND_URL = (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/$/, "");
    const patientLink = `${FRONTEND_URL}/consult/${roomName}`;

    // Look up doctor name for the doctor_link query params
    const doctorDoc = await Doctor.findOne({ doctor_id: appt.doctor_id })
      .select("_id name")
      .lean();
    const doctorName = doctorDoc?.name || "Doctor";
    const doctorLink = `${FRONTEND_URL}/doctor/join/${roomName}?doctorId=${doctorDoc?._id || ""}&doctorUsername=${encodeURIComponent(doctorName)}`;

    // ── Update the specific session in the array ────────────────────────────
    appt.sessions[idx].date         = date;
    appt.sessions[idx].time         = time;
    appt.sessions[idx].patient_link = patientLink;
    appt.sessions[idx].doctor_link  = doctorLink;
    appt.sessions[idx].status       = "confirmed";
    appt.sessions[idx].booked_at    = new Date();
    appt.markModified("sessions");

    // ── Mirror top-level fields to this newly scheduled session ────────────
    appt.date              = date;
    appt.time               = time;
    appt.twilio_room_name   = roomName;
    appt.twilio_room_sid    = roomSid;
    appt.patient_link       = patientLink;
    appt.doctor_link        = doctorLink;
    appt.status             = "confirmed";

    // Update concern suffix to reflect which session this now is
    const baseConcern = (appt.concern || "").replace(/\s*-\s*package\s+\w+\s+session\s*$/i, "");
    appt.concern = `${baseConcern} - package ${ordinal(Number(sessionNumber))} session`;

    await appt.save();

    res.json({
      success: true,
      message: `Session ${sessionNumber} scheduled`,
      appointment: appt,
    });

    // ── Background: WhatsApp notifications (non-blocking) ──────────────────
    setImmediate(async () => {
      try {
        const moment = require("moment-timezone");
        const TZ = "Asia/Kolkata";
        let displayTime = time;
        try {
          const dateStrIST = moment(date).tz(TZ).format("YYYY-MM-DD");
          const dt = moment.tz(`${dateStrIST} ${time}`, "YYYY-MM-DD h:mm A", TZ);
          if (dt.isValid()) displayTime = dt.format("h:mm A [on] DD MMM YYYY");
        } catch {}

        const patientName = appt.patient_name || "Patient";

        if (appt.patient_phone) {
          await sendTemplateMessage({
            to: appt.patient_phone,
            templateName: "patient_appointment_with_time",
            language: "en",
            params: [patientName, doctorName, displayTime, patientLink],
          }).catch(e => console.error("❌ Patient WA (follow-up) failed:", e.message));
        }

        if (doctorDoc) {
          const fullDoctor = await Doctor.findById(doctorDoc._id).select("phone_number").lean();
          if (fullDoctor?.phone_number) {
            await sendTemplateMessage({
              to: `91${fullDoctor.phone_number}`,
              templateName: "twilio_doctor_with_time_new",
              language: "en",
              params: [doctorName, patientName, displayTime, doctorLink],
            }).catch(e => console.error("❌ Doctor WA (follow-up) failed:", e.message));
          }
        }
      } catch (bgErr) {
        console.error("❌ Background follow-up notification failed:", bgErr.message);
      }
    });

  } catch (err) {
    console.error("POST /schedule-session error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error scheduling session",
      error: String(err?.message || err),
    });
  }
});


module.exports = router;