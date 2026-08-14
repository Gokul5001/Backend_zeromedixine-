// routes/clinicCalendarRoutes.js
/**
 * Clinic calendar events route
 * GET /api/calendar/clinic_events/:clinicId?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * - Returns combined events from:
 *    1) Appointment collection
 *    2) AddSession collection (sessions array)
 *    3) ClinicPatient collection (clinicpatients / addpatient)
 *
 * - Timezone-aware parsing using moment-timezone (CAL_TZ)
 * - Limits results for safety
 */

const express = require("express");
const router = express.Router();
const moment = require("moment-timezone");
const mongoose = require("mongoose");

// Models - adjust paths if your project uses different file locations
const Appointment = require("../Models/Appointment");
const AddSession = require("../Models/AddSession");
const ClinicPatient = require("../models/addpatient"); // CHANGE if your model file differs
const Clinic = require("../Models/Clinic");

// timezone used for parsing/formatting
const CAL_TZ = process.env.GOOGLE_CALENDAR_TZ || process.env.VITE_CAL_TZ || "Asia/Kolkata";

// Helper: try multiple date/time formats and return a moment in CAL_TZ
function parseDateAndTimeToMoment(dateStr, timeStr) {
  if (!dateStr) return null;
  const tz = CAL_TZ;
  const combos = [];

  // If both date and time are provided, try combined forms first (interpreted in CAL_TZ)
  if (timeStr && String(timeStr).trim()) {
    combos.push(`${dateStr} ${timeStr}`);        // "YYYY-MM-DD HH:mm"
    combos.push(`${dateStr}T${timeStr}`);       // "YYYY-MM-DDTHH:mm"
  }
  // date-only fallback
  combos.push(dateStr);

  for (const c of combos) {
    const m = moment.tz(c, ["YYYY-MM-DD HH:mm:ss", "YYYY-MM-DD HH:mm", "YYYY-MM-DDTHH:mm:ss", "YYYY-MM-DDTHH:mm", moment.ISO_8601], tz);
    if (m && m.isValid()) return m;
  }
  return null;
}

// Utility to coerce values to ISO date string if possible
function safeToISO(d) {
  if (!d) return null;
  try {
    const m = moment(d);
    if (m && m.isValid()) return m.toISOString();
  } catch (e) {}
  return null;
}

// GET /api/calendar/clinic_events/:clinicId
router.get("/clinic_events/:clinicId", async (req, res) => {
  try {
    const clinicId = (req.params.clinicId || "").trim();
    if (!clinicId || !mongoose.Types.ObjectId.isValid(clinicId)) {
      return res.status(400).json({ success: false, message: "Invalid clinic id" });
    }

    // Optional: ensure clinic exists
    const clinicExists = await Clinic.findById(clinicId).lean().catch(() => null);
    if (!clinicExists) {
      return res.status(404).json({ success: false, message: "Clinic not found" });
    }

    let { from, to } = req.query || {};

    const now = moment().tz(CAL_TZ);
    if (!from) from = now.clone().startOf("month").format("YYYY-MM-DD");
    if (!to) to = now.clone().endOf("month").format("YYYY-MM-DD");

    const fromM = moment.tz(from, "YYYY-MM-DD", CAL_TZ).startOf("day");
    const toM = moment.tz(to, "YYYY-MM-DD", CAL_TZ).endOf("day");

    // ---------- 1) Fetch appointments for clinic ----------
    const apptQuery = {
      $and: [
        {
          $or: [
            { clinic: clinicId },   // prefer field 'clinic'
            { clinicId: clinicId }  // fallback 'clinicId'
          ]
        },
        {
          $or: [
            { cdate: { $gte: from, $lte: to } },
            { appointment_date: { $gte: from, $lte: to } },
            { createdAt: { $gte: fromM.toDate(), $lte: toM.toDate() } }
          ]
        }
      ]
    };

    const appts = await Appointment.find(apptQuery).lean().limit(2000).catch((e) => {
      console.warn("Appointment find failed:", e && e.message);
      return [];
    });

    const apptEvents = appts.map((a) => {
      // Prefer appointment_date + appointment_time parsed in CAL_TZ
      let startMoment = null;
      if (a.appointment_date || a.cdate) {
        const dateStr = a.appointment_date || a.cdate;
        const timeStr = a.appointment_time || a.ctime || a.time || "";
        const parsed = parseDateAndTimeToMoment(dateStr, timeStr);
        if (parsed && parsed.isValid()) startMoment = parsed;
      }

      // fallback to createdAt
      if (!startMoment && a.createdAt) {
        const m = moment.tz(a.createdAt, CAL_TZ);
        if (m.isValid()) startMoment = m;
      }

      // fallback to ISO start field
      if (!startMoment && a.start) {
        const m = moment.tz(a.start, CAL_TZ);
        if (m.isValid()) startMoment = m;
      }

      if (!startMoment) startMoment = moment.tz(CAL_TZ);

      const durMin = Number(a.durationMinutes) || Number(a.duration) || 30;
      const endMoment = startMoment.clone().add(durMin, "minutes");

      const title = a.title || `Appt: ${a.name || a.patientName || "Patient"}`;

      return {
        id: a._id ? String(a._id) : `appt_${Math.random().toString(36).slice(2)}`,
        title,
        start: startMoment.toISOString(),
        end: endMoment.toISOString(),
        allDay: !!a.allDay || false,
        kind: "appointment",
        resource: { source: "appointment", raw: a }
      };
    });

    // ---------- 2) Fetch AddSession entries for clinic ----------
    const addSessionMatch = {
      $and: [
        {
          $or: [
            { clinic: clinicId },
            { clinicId: clinicId },
            { clinic_ref: clinicId } // alternate naming
          ]
        },
        {
          $or: [
            { "sessions.date": { $gte: from, $lte: to } },
            { "sessions.scheduledAt": { $gte: fromM.toDate(), $lte: toM.toDate() } },
            { createdAt: { $gte: fromM.toDate(), $lte: toM.toDate() } }
          ]
        }
      ]
    };

    const addSessions = await AddSession.find(addSessionMatch).lean().limit(2000).catch((e) => {
      console.warn("AddSession find failed:", e && e.message);
      return [];
    });

    const sessionEvents = [];
    addSessions.forEach((doc) => {
      const pkgName = doc.package_snapshot && doc.package_snapshot.package_name ? doc.package_snapshot.package_name : null;
      const sessArr = Array.isArray(doc.sessions) ? doc.sessions : [];
      sessArr.forEach((s) => {
        // PRIORITY: prefer session.date + session.time parsed in CAL_TZ first
        let startM = null;

        if (s.date || s.time) {
          const parsed = parseDateAndTimeToMoment(s.date || s.scheduledAt || doc.scheduledAt, s.time || "");
          if (parsed && parsed.isValid()) startM = parsed;
        }

        // If date+time not available/invalid, use scheduledAt (which may be UTC). Convert to CAL_TZ
        if (!startM && s.scheduledAt) {
          const m = moment.tz(s.scheduledAt, CAL_TZ);
          if (m.isValid()) startM = m;
        }

        // Fallback to parent createdAt if still absent
        if (!startM && doc.createdAt) {
          const m = moment.tz(doc.createdAt, CAL_TZ);
          if (m.isValid()) startM = m;
        }

        if (!startM || !startM.isValid()) return; // skip invalid

        // Only include if in requested range
        if (startM.isBefore(fromM) || startM.isAfter(toM)) return;

        const durMin = Number(s.durationMinutes || doc.package_snapshot?.duration_minutes || 30) || 30;
        const endM = startM.clone().add(durMin, "minutes");

        const title = s.title || (pkgName ? `Session: ${pkgName}` : `Session`);

        sessionEvents.push({
          id: s._id ? String(s._id) : `${doc._id}_${s.index || Math.random().toString(36).slice(2)}`,
          title,
          start: startM.toISOString(),
          end: endM.toISOString(),
          allDay: !!s.allDay || false,
          kind: "session",
          resource: {
            source: "addsession",
            addSessionId: String(doc._id),
            sessionIndex: s.index || null,
            raw: s,
            parent: doc
          }
        });
      });
    });

    // ---------- 3) Fetch ClinicPatient entries (clinicpatients collection) ----------
    const clinicPatientEvents = [];
    try {
      const cpQuery = {
        clinic: clinicId,
        $or: [
          { treatmentDate: { $gte: from, $lte: to } }, // if stored as 'YYYY-MM-DD' string
          { treatmentDate: { $gte: fromM.toDate(), $lte: toM.toDate() } }, // if stored as Date object
          { createdAt: { $gte: fromM.toDate(), $lte: toM.toDate() } } // fallback
        ]
      };

      const clinicPatients = await ClinicPatient.find(cpQuery).lean().limit(2000).catch((e) => {
        console.warn("ClinicPatient find failed:", e && e.message);
        return [];
      });

      clinicPatients.forEach((cp) => {
        let startM = null;

        // If treatmentDate is a Date object or ISO string
        if (cp.treatmentDate) {
          // handle possible object form from dumps: { $date: "..." }
          let candidate = cp.treatmentDate;
          if (candidate && candidate.$date) candidate = candidate.$date;

          // if candidate is Date-like
          const mCand = moment.tz(candidate, CAL_TZ);
          if (mCand && mCand.isValid()) startM = mCand;
        }

        // If treatmentTime present, try to parse with date+time to respect tz
        if (cp.treatmentDate && cp.treatmentTime) {
          const datePart = (typeof cp.treatmentDate === "string") ? cp.treatmentDate : (cp.treatmentDate ? moment(cp.treatmentDate).format("YYYY-MM-DD") : null);
          const parsed = parseDateAndTimeToMoment(datePart, cp.treatmentTime);
          if (parsed && parsed.isValid()) startM = parsed;
        }

        // fallback to createdAt
        if (!startM && cp.createdAt) {
          const m = moment.tz(cp.createdAt, CAL_TZ);
          if (m.isValid()) startM = m;
        }

        if (!startM) startM = moment.tz(CAL_TZ);

        // If out of requested range, skip
        if (startM.isBefore(fromM) || startM.isAfter(toM)) {
          // skip
        } else {
          const durMin = Number(cp.durationMinutes) || 30;
          const endM = startM.clone().add(durMin, "minutes");
          const title = cp.treatment ? `${cp.treatment} — ${cp.name || 'Patient'}` : `Appt: ${cp.name || 'Patient'}`;

          clinicPatientEvents.push({
            id: cp._id ? String(cp._id) : `cp_${Math.random().toString(36).slice(2)}`,
            title,
            start: startM.toISOString(),
            end: endM.toISOString(),
            allDay: false,
            kind: "appointment",
            resource: {
              source: "clinicpatient",
              raw: cp,
              patientName: cp.name,
              phone: cp.mobile,
              primaryConcern: cp.treatment,
              appointmentId: cp._id
            }
          });
        }
      });
    } catch (errCp) {
      console.warn("clinic patient fetch failed (non-fatal):", errCp && errCp.message);
    }

    // Combine and sort
    const combined = [...apptEvents, ...sessionEvents, ...clinicPatientEvents].sort((a, b) => {
      const da = new Date(a.start).getTime();
      const db = new Date(b.start).getTime();
      return da - db;
    });

    return res.json({ success: true, count: combined.length, events: combined });
  } catch (err) {
    console.error("Error in /api/calendar/clinic_events:", err && (err.stack || err));
    return res.status(500).json({ success: false, message: "Server error loading clinic calendar events", error: String(err) });
  }
});

module.exports = router;
