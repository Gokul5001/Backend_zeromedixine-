// routes/calendarRoutes.js
// Robust calendar events route (fixed session timezone handling)
// - Prefers appointment_date + appointment_time (or cdate + ctime) parsed in CAL_TZ
// - For sessions, prefers session.date + session.time parsed in CAL_TZ first, then scheduledAt
// - Falls back to createdAt / event.start when necessary
// - Returns ISO start/end strings suitable for react-big-calendar
// - Uses moment-timezone and respects CAL_TZ
// - Limits results for safety

const express = require("express");
const router = express.Router();
const moment = require("moment-timezone");

// Models - adjust these paths if your project structure differs
const Appointment = require("../Models/Appointment");
const AddSession = require("../Models/AddSession");

// timezone used by frontend and backend for consistent parsing/formatting
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

// Accepts query params: from=YYYY-MM-DD & to=YYYY-MM-DD (inclusive).
// If not provided, defaults to current month range.
router.get("/events", async (req, res) => {
  try {
    let { from, to } = req.query || {};

    const now = moment().tz(CAL_TZ);
    if (!from) from = now.clone().startOf("month").format("YYYY-MM-DD");
    if (!to) to = now.clone().endOf("month").format("YYYY-MM-DD");

    // Convert to moment range (inclusive)
    const fromM = moment.tz(from, "YYYY-MM-DD", CAL_TZ).startOf("day");
    const toM = moment.tz(to, "YYYY-MM-DD", CAL_TZ).endOf("day");

    // ---------- 1) Fetch appointments ----------
    const apptQuery = {
      $or: [
        { cdate: { $gte: from, $lte: to } },          // string YYYY-MM-DD
        { appointment_date: { $gte: from, $lte: to } },
        { createdAt: { $gte: fromM.toDate(), $lte: toM.toDate() } } // fallback to createdAt timestamps
      ]
    };

    const appts = await Appointment.find(apptQuery).lean().limit(1000);

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

      // last fallback: if appointment doc contains ISO 'start' field
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

    // ---------- 2) Fetch AddSession entries ----------
    const addSessionMatch = {
      $or: [
        { "sessions.date": { $gte: from, $lte: to } },
        { "sessions.scheduledAt": { $gte: fromM.toDate(), $lte: toM.toDate() } },
        { createdAt: { $gte: fromM.toDate(), $lte: toM.toDate() } }
      ]
    };

    const addSessions = await AddSession.find(addSessionMatch).lean().limit(1000);

    const sessionEvents = [];
    addSessions.forEach((doc) => {
      const pkgName = doc.package_snapshot && doc.package_snapshot.package_name ? doc.package_snapshot.package_name : null;
      const sessArr = Array.isArray(doc.sessions) ? doc.sessions : [];
      sessArr.forEach((s) => {
        // PRIORITY FIX: prefer session.date + session.time parsed in CAL_TZ first
        let startM = null;

        if (s.date || s.time) {
          const parsed = parseDateAndTimeToMoment(s.date || s.scheduledAt, s.time || "");
          if (parsed && parsed.isValid()) startM = parsed;
        }

        // If date+time not available/invalid, use scheduledAt (which may be UTC). Use moment.tz to convert to CAL_TZ correctly.
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

        const title = s.title || (pkgName ? `Session: ${pkgName}` : `Session for ${doc._id}`);

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

    // Combine and sort
    const combined = [...apptEvents, ...sessionEvents].sort((a, b) => new Date(a.start) - new Date(b.start));

    return res.json({ success: true, count: combined.length, events: combined });
  } catch (err) {
    console.error("Error in /api/calendar/events:", err && err.stack ? err.stack : err);
    return res.status(500).json({ success: false, message: "Server error loading calendar events", error: String(err) });
  }
});

module.exports = router;
