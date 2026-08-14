// Routes/superadmin.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const LoginCredential = require("../Models/LoginCredential");
const Appointment = require("../Models/Appointment"); // Add this import
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

// Super Admin Login (keep this same)
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ success: false, message: "Username and password required" });
    }

    const raw = String(username).trim();
    const esc = raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const query = {
      $or: [
        { username: { $regex: new RegExp(`^${esc}$`, "i") } },
        { user: { $regex: new RegExp(`^${esc}$`, "i") } },
        { user_name: { $regex: new RegExp(`^${esc}$`, "i") } },
        { mobile_no: raw },
        { email: { $regex: new RegExp(`^${esc}$`, "i") } }
      ],
      role: "superadmin"
    };

    const user = await LoginCredential.findOne(query).lean();
    if (!user) {
      return res.status(401).json({ success: false, message: "Invalid super admin credentials" });
    }

    const stored = user.password || "";
    let passwordMatches = false;

    if (/^\$2[ayb]\$/.test(stored)) {
      passwordMatches = await bcrypt.compare(password, stored);
    } else {
      passwordMatches = stored === password;
      if (passwordMatches) {
        try {
          const newHash = await bcrypt.hash(password, 12);
          await LoginCredential.updateOne({ _id: user._id }, { $set: { password: newHash } });
        } catch (e) {
          console.warn("Password migration failed for superadmin", user._id, e);
        }
      }
    }

    if (!passwordMatches) {
      return res.status(401).json({ success: false, message: "Invalid super admin credentials" });
    }

    let token = null;
    if (process.env.JWT_SECRET) {
      token = jwt.sign(
        { 
          id: user._id.toString(), 
          username: user.username || user.user || user.user_name || null, 
          role: "superadmin"
        },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES || "8h" }
      );
    }

    if (token) {
      res.cookie("superadmin_token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 1000 * 60 * 60 * 8,
      });
    }

    const safeUser = {
      _id: user._id,
      username: user.username || user.user || user.user_name || null,
      email: user.email || null,
      mobile_no: user.mobile_no || null,
      role: "superadmin",
    };

    return res.json({ success: true, user: safeUser, token: token || null });
  } catch (err) {
    console.error("SuperAdmin Login error:", err);
    return res.status(500).json({ success: false, message: "Server error during super admin login" });
  }
});

// Simple - Get all appointments
// routes/superadmin.js  (replace the existing GET /appointmentsall handler with this)
// routes/superadmin.js  (replace the existing GET /appointmentsall handler with this)
// routes/superadmin.js  (replace the existing GET /appointmentsall handler with this)
router.get("/appointmentsall", async (req, res) => {
  try {
    console.log("🔄 SuperAdmin fetching ALL appointments (concern + doctor + payment + sessions)...");

    // fetch appointments (populate primaryConcern if it's a ref)
    const appointments = await Appointment.find()
      .populate({ path: "primaryConcern", select: "concern" })
      .sort({ cdate: -1, ctime: -1, createdAt: -1 })
      .lean();

    console.log(`✅ Found ${appointments.length} appointments (raw)`);

    // collect doctor ids and appointment ids
    const doctorIdStrings = [
      ...new Set(
        appointments
          .map((a) => {
            if (!a) return null;
            const d = a.doctorAssigned;
            if (!d) return null;
            return typeof d === "string" ? d : String(d);
          })
          .filter(Boolean)
          .filter((s) => /^[0-9a-fA-F]{24}$/.test(s))
      ),
    ];

    const appointmentIdStrings = [
      ...new Set(
        appointments
          .map((a) => (a && a._id ? String(a._id) : null))
          .filter(Boolean)
          .filter((s) => /^[0-9a-fA-F]{24}$/.test(s))
      ),
    ];

    // resolve doctorAssigned -> username (same approach as before)
    let doctorMap = {};
    if (doctorIdStrings.length) {
      const allCols = await mongoose.connection.db.listCollections().toArray();
      const found = allCols.find((c) => String(c.name).trim().toLowerCase() === "login_credentials");
      const credCollName = found ? found.name : "login_credentials";
      const credColl = mongoose.connection.collection(credCollName);

      const creds = await credColl
        .find({ _id: { $in: doctorIdStrings.map((id) => new mongoose.Types.ObjectId(id)) } })
        .project({ _id: 1, username: 1, user: 1, user_name: 1 })
        .toArray();

      creds.forEach((c) => {
        const uname = c.username || c.user || c.user_name || "";
        doctorMap[String(c._id)] = uname;
      });
    }

    // lookup payments for these appointments (if any)
    let paymentMap = {}; // appointmentId -> payment object (pick latest)
    if (appointmentIdStrings.length) {
      const allCols = await mongoose.connection.db.listCollections().toArray();
      // try to find payments collection flexibly
      const payFound = allCols.find((c) => String(c.name).trim().toLowerCase().includes("payment"));
      const payCollName = payFound ? payFound.name : "payments";
      const payColl = mongoose.connection.collection(payCollName);

      const payments = await payColl
        .find({ appointmentId: { $in: appointmentIdStrings.map((id) => new mongoose.Types.ObjectId(id)) } })
        .toArray();

      payments.forEach((p) => {
        try {
          const aid = p.appointmentId ? String(p.appointmentId) : null;
          if (!aid) return;
          const existing = paymentMap[aid];
          const thisTs = (p.updatedAt && new Date(p.updatedAt)) || (p.createdAt && new Date(p.createdAt)) || new Date();
          if (!existing) {
            paymentMap[aid] = { doc: p, ts: thisTs };
          } else {
            const exTs = existing.ts || new Date(0);
            if (thisTs > exTs) paymentMap[aid] = { doc: p, ts: thisTs };
          }
        } catch (e) { /* ignore */ }
      });
    }

    // lookup addsessions (or similarly-named) for these appointments
    // We'll return an array (because there can be >1 addsessions doc per appointment)
    let sessionsMap = {}; // appointmentId -> [sessionDocs]
    if (appointmentIdStrings.length) {
      const allCols = await mongoose.connection.db.listCollections().toArray();
      // try to find a collection whose name contains "session" (prefer addsessions)
      const sessFound =
        allCols.find((c) => String(c.name).trim().toLowerCase() === "addsessions") ||
        allCols.find((c) => String(c.name).trim().toLowerCase().includes("addsess")) ||
        allCols.find((c) => String(c.name).trim().toLowerCase().includes("session"));
      const sessCollName = sessFound ? sessFound.name : "addsessions";
      const sessColl = mongoose.connection.collection(sessCollName);

      // find all addsessions with appointmentId in our list
      const sessDocs = await sessColl
        .find({ appointmentId: { $in: appointmentIdStrings.map((id) => new mongoose.Types.ObjectId(id)) } })
        .toArray();

      sessDocs.forEach((s) => {
        try {
          const aid = s.appointmentId ? String(s.appointmentId) : null;
          if (!aid) return;
          sessionsMap[aid] = sessionsMap[aid] || [];
          sessionsMap[aid].push(s);
        } catch (e) { /* ignore */ }
      });
    }

    // shape response and attach resolved doctor username + payment summary + sessions data
    const shaped = appointments.map((a) => {
      const docId = a.doctorAssigned ? (typeof a.doctorAssigned === "string" ? a.doctorAssigned : String(a.doctorAssigned)) : "";
      const resolvedUsername = (docId && doctorMap[docId]) || (a.doctorAssignedUsername || "") || "";

      // payment
      const paymentEntry = paymentMap[String(a._id)] ? paymentMap[String(a._id)].doc : null;
      let paymentObj = null;
      if (paymentEntry) {
        paymentObj = {
          _id: paymentEntry._id,
          appointmentId: paymentEntry.appointmentId ? String(paymentEntry.appointmentId) : null,
          linkId: paymentEntry.linkId || null,
          linkShortUrl: paymentEntry.linkShortUrl || paymentEntry.link_short_url || null,
          amount: paymentEntry.amount != null ? (typeof paymentEntry.amount === "object" && paymentEntry.amount.$numberInt ? Number(paymentEntry.amount.$numberInt) : paymentEntry.amount) : null,
          currency: paymentEntry.currency || null,
          purpose: paymentEntry.purpose || null,
          status: paymentEntry.status || null,
          razorpay_payment_id: paymentEntry.razorpay_payment_id || null,
          razorpay_order_id: paymentEntry.razorpay_order_id || null,
          customer: paymentEntry.customer || null,
          invoice: paymentEntry.invoice || null,
          raw: paymentEntry.raw || null,
          createdAt: paymentEntry.createdAt || paymentEntry.created_at || null,
          updatedAt: paymentEntry.updatedAt || paymentEntry.updated_at || null,
        };
      }

      // sessions (could be multiple addsessions docs). normalize fields we care about
      const sessDocs = sessionsMap[String(a._id)] || [];
      const sessionsNormalized = sessDocs.map((sd) => {
        // sessions array inside sd (each session item)
        const sessionsList = Array.isArray(sd.sessions) ? sd.sessions.map((it) => {
          return {
            index: it.index != null ? (typeof it.index === "object" && it.index.$numberInt ? Number(it.index.$numberInt) : it.index) : null,
            date: it.date || null,
            time: it.time || null,
            scheduledAt: it.scheduledAt || it.scheduled_at || null,
            twilioRoomPatient: it.twilioRoomPatient || null,
            twilioRoomDoctor: it.twilioRoomDoctor || null,
            session_handled: it.session_handled ? String(it.session_handled) : (it.session_handled || null),
            session_handled_display: it.session_handled_display || null,
            treatment: it.treatment || null,
            reschedule: it.reschedule || null,
            sendReminder: it.sendReminder || false,
            sessionNotificationSent: it.sessionNotificationSent || false,
            chiefComplaints: it.chiefComplaints || it.chief_complaints || "",
            enquiryNotes: it.enquiryNotes || it.enquiry_notes || "",
          };
        }) : [];

        return {
          _id: sd._id,
          appointmentId: sd.appointmentId ? String(sd.appointmentId) : null,
          session: sd.session ? String(sd.session) : null,
          doctorAssigned: sd.doctorAssigned ? String(sd.doctorAssigned) : null,
          package_snapshot: sd.package_snapshot || null,
          sessions: sessionsList,
          status: sd.status || null,
          consentForm: sd.consentForm || null,
          invoice: sd.invoice || null,
          createdAt: sd.createdAt || null,
          updatedAt: sd.updatedAt || null,
          notes: sd.notes || null,
        };
      });

      return {
        _id: a._id,
        name: a.name || "",
        age: a.age || "",
        gender: a.gender || "",
        phone: a.phone || "",
        email: a.email || "",
        primaryConcern: a.primaryConcern && a.primaryConcern.concern ? a.primaryConcern.concern : (typeof a.primaryConcern === "string" ? a.primaryConcern : ""),
        appointment_date: a.appointment_date || "",
        appointment_time: a.appointment_time || "",
        cdate: a.cdate || "",
        ctime: a.ctime || "",
        language: a.language || "",
        status: a.status || "",
        doctorAssigned: docId || "",
        doctorAssignedUsername: resolvedUsername,
        couponCode: a.couponCode || null,
        twilioRoomName: a.twilioRoom && a.twilioRoom.roomName ? a.twilioRoom.roomName : (a.twilioRoomName || null),
        chief_complaints: a.chiefComplaint || a.chief_complaints || "",
        notes: a.enquiryNotes || a.notes || "",
        address: a.address || "",
        payment: paymentObj,               // (object | null)
        sessionsData: sessionsNormalized,  // array (may be empty)
      };
    });

    return res.json({
      success: true,
      count: shaped.length,
      appointments: shaped,
    });
  } catch (err) {
    console.error("❌ Error in GET /api/superadmin/appointments:", err);
    return res.status(500).json({
      success: false,
      message: "Server error fetching appointments: " + (err && err.message ? err.message : err),
    });
  }
});




module.exports = router;