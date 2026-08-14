// // routes/calendarRoutes_specific.js - UPDATED VERSION
// const express = require("express");
// const router = express.Router();
// const Appointment = require("../Models/Appointment");
// const AddSession = require("../Models/AddSession");
// const mongoose = require("mongoose");
// const moment = require("moment-timezone");

// router.get("/specific_events", async (req, res) => {
//   try {
//     const { from, to, doctorId, username } = req.query || {};
//     const tz = process.env.CAL_TZ || "Asia/Kolkata";

//     // Build date filter
//     const dateClauses = [];
//     if (from) {
//       dateClauses.push({
//         $or: [
//           { cdate: { $gte: from } },
//           { appointment_date: { $gte: from } }
//         ]
//       });
//     }
//     if (to) {
//       dateClauses.push({
//         $or: [
//           { cdate: { $lte: to } },
//           { appointment_date: { $lte: to } }
//         ]
//       });
//     }

//     // Build doctor filter - FIXED
//     const doctorClauses = [];
    
//     if (doctorId) {
//       // Convert string doctorId to ObjectId for comparison
//       const doctorObjectId = mongoose.Types.ObjectId.isValid(doctorId) 
//         ? new mongoose.Types.ObjectId(doctorId) 
//         : null;
      
//       if (doctorObjectId) {
//         // Check in doctorAssigned field (ObjectId) - This is what your data has
//         doctorClauses.push({ doctorAssigned: doctorObjectId });
//         // Also check other possible fields
//         doctorClauses.push({ doctorAssignedId: doctorId });
//         doctorClauses.push({ doctorId: doctorId });
//       } else {
//         // If not a valid ObjectId, still try string comparison
//         doctorClauses.push({ doctorAssigned: doctorId });
//         doctorClauses.push({ doctorAssignedId: doctorId });
//         doctorClauses.push({ doctorId: doctorId });
//       }
//     }
    
//     if (username) {
//       // Check username fields
//       doctorClauses.push({ doctorAssignedUsername: username });
//       doctorClauses.push({ doctorUsername: username });
//     }

//     // Combine into final appointment filter
//     const appointmentFilter = {};
//     const andClauses = [];
    
//     if (dateClauses.length) andClauses.push(...dateClauses);
    
//     if (doctorClauses.length) {
//       // IMPORTANT: Use $or to match ANY of the doctor clauses
//       appointmentFilter.$or = doctorClauses;
      
//       // If we also have date clauses, we need to combine them with $and
//       if (dateClauses.length) {
//         appointmentFilter.$and = [
//           { $or: doctorClauses },
//           ...dateClauses
//         ];
//         // Remove the separate $or since we moved it into $and
//         delete appointmentFilter.$or;
//       }
//     } else if (dateClauses.length) {
//       // If only date clauses exist
//       appointmentFilter.$and = dateClauses;
//     }

//     console.log("Appointment filter:", JSON.stringify(appointmentFilter, null, 2));

//     // Fetch appointments (filtered by date & doctor if provided)
//     const appointments = await Appointment.find(appointmentFilter).lean();
    
//     console.log(`Found ${appointments.length} appointments`);

//     // Fetch addSessions
//     const addSessionsAll = await AddSession.find().lean();

//     // Transform appointments for calendar
//     const appointmentEvents = appointments.map(appt => {
//       let eventDate = appt.appointment_date || appt.cdate;
//       let eventTime = appt.appointment_time || appt.ctime;

//       let start;
//       if (eventDate && eventTime) {
//         start = moment.tz(`${eventDate} ${eventTime}`, "YYYY-MM-DD HH:mm:ss", tz);
//         if (!start.isValid()) {
//           start = moment.tz(`${eventDate} ${eventTime}`, "YYYY-MM-DD HH:mm", tz);
//         }
//       } else if (eventDate) {
//         start = moment.tz(eventDate, "YYYY-MM-DD", tz);
//       }

//       if (!start || !start.isValid()) {
//         start = moment.tz(appt.createdAt || new Date(), tz);
//       }

//       const end = start.clone().add(30, 'minutes');

//       return {
//         id: appt._id.toString(),
//         title: `Appt: ${appt.name || "Patient"}`,
//         start: start.toDate(),
//         end: end.toDate(),
//         allDay: false,
//         resource: appt,
//         kind: "appointment",
//         color: "#e8f7ff",
//         patientName: appt.name,
//         primaryConcern: appt.primaryConcern,
//         phone: appt.phone,
//         cdate: appt.cdate,
//         ctime: appt.ctime,
//         appointment_date: appt.appointment_date,
//         appointment_time: appt.appointment_time,
//         doctorAssignedUsername: appt.doctorAssignedUsername,
//         doctorAssignedId: appt.doctorAssignedId || appt.doctorId
//       };
//     });

//     // Transform addSessions but only include those matching doctor filter (if provided)
//     const sessionEvents = [];

//     // Helper to check whether an addSession matches doctor filter
//     function sessionMatchesDoctor(addSession) {
//       if (!doctorClauses.length && !username) return true; // no doctor filter => match all
      
//       // Check for username match
//       if (username) {
//         const sUsername = addSession.doctorAssignedUsername || addSession.doctorUsername;
//         if (sUsername && sUsername === username) return true;
//       }
      
//       // Check for doctorId match
//       if (doctorId) {
//         const sId = addSession.doctorAssignedId || addSession.doctorId || 
//                    (addSession.doctor && addSession.doctor._id && addSession.doctor._id.toString());
        
//         if (sId && sId.toString() === doctorId.toString()) return true;
//       }
      
//       return false;
//     }

//     addSessionsAll.forEach(addSession => {
//       if (!addSession.sessions || !Array.isArray(addSession.sessions)) return;
//       // Skip whole addSession if doctor filter present and doesn't match
//       if ((doctorId || username) && !sessionMatchesDoctor(addSession)) return;

//       addSession.sessions.forEach(session => {
//         if (!session.date) return;

//         let eventDate = session.date;
//         let eventTime = session.time || "00:00";

//         let start = moment.tz(`${eventDate} ${eventTime}`, "YYYY-MM-DD HH:mm:ss", tz);
//         if (!start.isValid()) {
//           start = moment.tz(`${eventDate} ${eventTime}`, "YYYY-MM-DD HH:mm", tz);
//         }
//         if (!start.isValid()) {
//           start = moment.tz(eventDate, "YYYY-MM-DD", tz);
//         }

//         if (session.scheduledAt && moment(session.scheduledAt).isValid()) {
//           start = moment.tz(session.scheduledAt, tz);
//         }

//         if (!start || !start.isValid()) return;

//         const end = start.clone().add(60, 'minutes');

//         const packageName = addSession.package_snapshot?.package_name || "Session";
//         const sessionIndex = session.index || 1;

//         sessionEvents.push({
//           id: `${addSession._id}_session_${session.index || 1}`,
//           title: `Session: ${packageName} (${sessionIndex})`,
//           start: start.toDate(),
//           end: end.toDate(),
//           allDay: false,
//           resource: {
//             ...addSession,
//             sessionData: session
//           },
//           kind: "session",
//           color: "#fff4e6",
//           packageName: packageName,
//           sessionIndex: sessionIndex,
//           session_handled_display: session.session_handled_display,
//           doctorAssignedUsername: addSession.doctorAssignedUsername,
//           doctorAssignedId: addSession.doctorAssignedId || addSession.doctorId,
//           appointmentId: addSession.appointmentId,
//           chiefComplaints: session.chiefComplaints,
//           enquiryNotes: session.enquiryNotes
//         });
//       });
//     });

//     // Combine events and optionally apply the date filtering again (defensive)
//     let allEvents = [...appointmentEvents, ...sessionEvents];
//     if (from || to) {
//       allEvents = allEvents.filter(evt => {
//         const start = moment(evt.start);
//         if (from && start.isBefore(moment(from), 'day')) return false;
//         if (to && start.isAfter(moment(to), 'day')) return false;
//         return true;
//       });
//     }

//     return res.json({
//       success: true,
//       events: allEvents,
//       counts: {
//         appointments: appointmentEvents.length,
//         sessions: sessionEvents.length,
//         total: allEvents.length
//       }
//     });

//   } catch (err) {
//     console.error("Error fetching calendar events:", err);
//     return res.status(500).json({
//       success: false,
//       message: "Server error fetching calendar events",
//       error: String(err)
//     });
//   }
// });

// module.exports = router;


// routes/calendarRoutes_specific.js - FIXED (timezone + session filtering)
const express = require("express");
const router = express.Router();
const Appointment = require("../Models/Appointment");
const AddSession = require("../Models/AddSession");
const mongoose = require("mongoose");
const moment = require("moment-timezone");

router.get("/specific_events", async (req, res) => {
  try {
    const { from, to, doctorId, username } = req.query || {};
    const tz = process.env.CAL_TZ || "Asia/Kolkata";

    // Build date filter (string YYYY-MM-DD comparisons)
    const dateClauses = [];
    if (from) {
      dateClauses.push({
        $or: [
          { cdate: { $gte: from } },
          { appointment_date: { $gte: from } }
        ]
      });
    }
    if (to) {
      dateClauses.push({
        $or: [
          { cdate: { $lte: to } },
          { appointment_date: { $lte: to } }
        ]
      });
    }

    // Build doctor filter clauses (we will use them in both appointments and sessions)
    const doctorClauses = [];
    if (doctorId) {
      const doctorObjectId = mongoose.Types.ObjectId.isValid(doctorId)
        ? new mongoose.Types.ObjectId(doctorId)
        : null;

      // Try common fields where doctor may be stored
      if (doctorObjectId) {
        doctorClauses.push({ doctorAssigned: doctorObjectId });
      }
      doctorClauses.push({ doctorAssignedId: doctorId });
      doctorClauses.push({ doctorId: doctorId });
      doctorClauses.push({ doctorAssigned: doctorId }); // in case stored as string
    }
    if (username) {
      doctorClauses.push({ doctorAssignedUsername: username });
      doctorClauses.push({ doctorUsername: username });
    }

    // Build appointmentFilter combining date & doctor
    const appointmentFilter = {};
    if (doctorClauses.length && dateClauses.length) {
      appointmentFilter.$and = [{ $or: doctorClauses }, ...dateClauses];
    } else if (doctorClauses.length) {
      appointmentFilter.$or = doctorClauses;
    } else if (dateClauses.length) {
      appointmentFilter.$and = dateClauses;
    }

    console.log("Appointment filter:", JSON.stringify(appointmentFilter, null, 2));

    // Fetch appointments (filtered)
    const appointments = await Appointment.find(appointmentFilter).lean();
    console.log(`Found ${appointments.length} appointments`);

    // Helper: safe parse of date+time strings in CAL_TZ (prefer date+time first)
    function parseLocalDateTime(dateStr, timeStr) {
      if (!dateStr) return null;
      const date = String(dateStr);
      const time = timeStr ? String(timeStr) : "";
      // try with seconds, then minutes, then date-only
      const tryFormats = [
        `${date} ${time}`, // try combined
        `${date}T${time}`,
        date
      ];
      for (const val of tryFormats) {
        const m = moment.tz(val, ["YYYY-MM-DD HH:mm:ss", "YYYY-MM-DD HH:mm", "YYYY-MM-DDTHH:mm:ss", "YYYY-MM-DDTHH:mm", moment.ISO_8601], tz);
        if (m && m.isValid()) return m;
      }
      return null;
    }

    // Transform appointments for calendar
    const appointmentEvents = appointments.map(appt => {
      const eventDate = appt.appointment_date || appt.cdate;
      const eventTime = appt.appointment_time || appt.ctime || appt.time || "";
      let start = null;

      // Prefer local date+time
      if (eventDate) start = parseLocalDateTime(eventDate, eventTime);

      // Fallback to createdAt
      if ((!start || !start.isValid()) && appt.createdAt) {
        start = moment.tz(appt.createdAt, tz);
      }

      // Last fallback: now
      if (!start || !start.isValid()) start = moment.tz(tz);

      const dur = Number(appt.durationMinutes || appt.duration || 30) || 30;
      const end = start.clone().add(dur, "minutes");

      return {
        id: appt._id ? String(appt._id) : `appt_${Math.random().toString(36).slice(2)}`,
        title: `Appt: ${appt.name || appt.patientName || "Patient"}`,
        start: start.toDate(),
        end: end.toDate(),
        allDay: !!appt.allDay || false,
        resource: appt,
        kind: "appointment",
        color: "#e8f7ff",
        patientName: appt.name || appt.patientName,
        primaryConcern: appt.primaryConcern,
        phone: appt.phone,
        cdate: appt.cdate,
        ctime: appt.ctime,
        appointment_date: appt.appointment_date,
        appointment_time: appt.appointment_time,
        doctorAssignedUsername: appt.doctorAssignedUsername,
        doctorAssignedId: appt.doctorAssignedId || appt.doctorId || appt.doctorAssigned
      };
    });

    // Fetch addSessions (we'll filter later with flexible logic)
    const addSessionsAll = await AddSession.find().lean();

    // Helper: determine if an addSession or its sessions match the doctor filter
    function sessionMatchesDoctor(addSession, session) {
      // No filter => match
      if (!doctorId && !username) return true;

      // Check username matches (session-level or addSession-level)
      if (username) {
        // session-level display name
        if (session && session.session_handled_display && session.session_handled_display === username) return true;
        // addSession-level username fields
        if (addSession.doctorAssignedUsername && addSession.doctorAssignedUsername === username) return true;
        if (addSession.doctorUsername && addSession.doctorUsername === username) return true;
      }

      // Check doctorId matches (several possible fields)
      if (doctorId) {
        const sIdCandidates = [
          // session-level
          session && (session.session_handled || session.session_handled_id || session.session_handledId),
          // addSession-level direct fields
          addSession.doctorAssignedId || addSession.doctorAssigned || addSession.doctorId,
          // sometimes nested under parent
          addSession.parent && (addSession.parent.doctorAssigned || addSession.parent.doctorAssignedId || addSession.parent.doctorId)
        ].flat ? [].concat(...[ // safety flatten in older node versions
          session && (session.session_handled || session.session_handled_id || session.session_handledId) ? [session.session_handled || session.session_handled_id || session.session_handledId] : [],
          addSession.doctorAssignedId ? [addSession.doctorAssignedId] : [],
          addSession.doctorAssigned ? [addSession.doctorAssigned] : [],
          addSession.doctorId ? [addSession.doctorId] : [],
          addSession.parent && addSession.parent.doctorAssigned ? [addSession.parent.doctorAssigned] : [],
          addSession.parent && addSession.parent.doctorAssignedId ? [addSession.parent.doctorAssignedId] : [],
          addSession.parent && addSession.parent.doctorId ? [addSession.parent.doctorId] : []
        ]) : [
          session && (session.session_handled || session.session_handled_id || session.session_handledId),
          addSession.doctorAssignedId, addSession.doctorAssigned, addSession.doctorId,
          addSession.parent && addSession.parent.doctorAssigned, addSession.parent && addSession.parent.doctorAssignedId, addSession.parent && addSession.parent.doctorId
        ];

        // normalize to strings and compare
        for (const candidate of sIdCandidates) {
          if (!candidate) continue;
          try {
            if (candidate.toString && candidate.toString() === doctorId.toString()) return true;
            if (String(candidate) === String(doctorId)) return true;
          } catch (e) {
            // ignore
          }
        }
      }

      return false;
    }

    // Helper: compute session start moment (prefer date+time parsed in tz, else scheduledAt only if date/time missing)
    function computeSessionStart(session, addSessionDoc) {
      // try session.date + session.time (local)
      const eventDate = session.date || (addSessionDoc && addSessionDoc.session && addSessionDoc.session.date);
      const eventTime = session.time || (addSessionDoc && addSessionDoc.session && addSessionDoc.session.time);

      let start = null;
      if (eventDate) {
        start = parseLocalDateTime(eventDate, eventTime || "");
      }

      // If date+time not available or invalid, use scheduledAt (ISO) as fallback
      if ((!start || !start.isValid()) && session.scheduledAt) {
        // parse scheduledAt as ISO then convert to tz (moment will handle offsets)
        const m = moment(session.scheduledAt);
        if (m && m.isValid()) {
          start = moment.tz(m.toISOString(), tz);
        }
      }

      // fallback to parent createdAt
      if ((!start || !start.isValid()) && addSessionDoc && addSessionDoc.createdAt) {
        const m = moment.tz(addSessionDoc.createdAt, tz);
        if (m && m.isValid()) start = m;
      }

      // last-resort: now
      if (!start || !start.isValid()) start = moment.tz(tz);

      return start;
    }

    // Transform addSessions -> sessionEvents
    const sessionEvents = [];
    addSessionsAll.forEach(addSession => {
      if (!Array.isArray(addSession.sessions)) return;

      addSession.sessions.forEach(session => {
        // match doctor filter for this specific session
        if ((doctorId || username) && !sessionMatchesDoctor(addSession, session)) {
          return; // skip this session
        }

        // session must have a date or scheduledAt to be meaningful
        if (!session.date && !session.scheduledAt && !addSession.createdAt) return;

        // compute start using helper
        const startMoment = computeSessionStart(session, addSession);
        if (!startMoment || !startMoment.isValid()) return;

        // Optional: if from/to filters given, filter here (comparing date only)
        if (from && startMoment.isBefore(moment.tz(from, "YYYY-MM-DD", tz), "day")) return;
        if (to && startMoment.isAfter(moment.tz(to, "YYYY-MM-DD", tz), "day")) return;

        // Duration: prefer session.durationMinutes -> parent.package_snapshot.duration_minutes -> default 30/60 as needed
        const dur = Number(session.durationMinutes || addSession.package_snapshot?.duration_minutes || 30) || 30;
        const endMoment = startMoment.clone().add(dur, "minutes");

        const packageName = addSession.package_snapshot?.package_name || addSession.package_name || "Session";
        const sessionIndex = session.index || 1;

        sessionEvents.push({
          id: `${addSession._id}_session_${session.index || sessionIndex}`,
          title: `Session: ${packageName}`,
          start: startMoment.toDate(),
          end: endMoment.toDate(),
          allDay: !!session.allDay || false,
          resource: {
            source: "addsession",
            addSessionId: String(addSession._id),
            sessionIndex: sessionIndex,
            raw: session,
            parent: addSession
          },
          kind: "session",
          color: "#fff4e6",
          packageName,
          sessionIndex,
          session_handled_display: session.session_handled_display || addSession.session_handled_display || addSession.sessionHandledDisplay,
          doctorAssignedUsername: addSession.doctorAssignedUsername || addSession.doctorUsername,
          doctorAssignedId: addSession.doctorAssignedId || addSession.doctorAssigned || addSession.doctorId,
          appointmentId: addSession.appointmentId || addSession.parent?.appointmentId,
          chiefComplaints: session.chiefComplaints,
          enquiryNotes: session.enquiryNotes
        });
      });
    });

    // Combine events
    let allEvents = [...appointmentEvents, ...sessionEvents];

    // Defensive date filter again (if from/to provided)
    if (from || to) {
      allEvents = allEvents.filter(evt => {
        const start = moment(evt.start).tz(tz);
        if (from && start.isBefore(moment.tz(from, "YYYY-MM-DD", tz), "day")) return false;
        if (to && start.isAfter(moment.tz(to, "YYYY-MM-DD", tz), "day")) return false;
        return true;
      });
    }

    return res.json({
      success: true,
      events: allEvents,
      counts: {
        appointments: appointmentEvents.length,
        sessions: sessionEvents.length,
        total: allEvents.length
      }
    });

  } catch (err) {
    console.error("Error fetching calendar events:", err && err.stack ? err.stack : err);
    return res.status(500).json({
      success: false,
      message: "Server error fetching calendar events",
      error: String(err)
    });
  }
});

module.exports = router;
