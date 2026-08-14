const { google } = require("googleapis");
const moment = require("moment-timezone");

async function createCalendarEventUsingOAuth(appointment, doctorEmail) {
  try {
    if (
      !process.env.GOOGLE_OAUTH_CLIENT_ID ||
      !process.env.GOOGLE_OAUTH_CLIENT_SECRET ||
      !process.env.GOOGLE_OAUTH_REFRESH_TOKEN_CAL
    ) {
      console.warn("OAuth credentials or refresh token missing — skipping calendar creation.");
      return null;
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_OAUTH_CLIENT_ID,
      process.env.GOOGLE_OAUTH_CLIENT_SECRET
    );

    oauth2Client.setCredentials({
      refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN_CAL
    });

    const calendar = google.calendar({ version: "v3", auth: oauth2Client });

    const tz = process.env.GOOGLE_CALENDAR_TZ || "Asia/Kolkata";
    const dateStr = appointment.appointment_date || appointment.date;
    const timeStr = appointment.appointment_time || appointment.time;

    if (!dateStr || !timeStr) {
      console.warn("Appointment missing date/time, skipping calendar event.");
      return null;
    }

    let start = moment.tz(`${dateStr} ${timeStr}`, "YYYY-MM-DD HH:mm:ss", tz);
    if (!start.isValid()) start = moment.tz(`${dateStr} ${timeStr}`, "YYYY-MM-DD HH:mm", tz);
    if (!start.isValid()) start = moment.tz(`${dateStr}T${timeStr}`, tz);
    if (!start.isValid()) return null;

    const end = start.clone().add(30, "minutes");

    const event = {
      summary: `Consult — ${appointment.name || "Patient"}${
        appointment.primaryConcern ? ` (${appointment.primaryConcern})` : ""
      }`,
      description: `Patient: ${appointment.name || ""}\nPhone: ${
        appointment.phone || ""
      }\nNotes: ${appointment.enquiryNotes || ""}`,
      start: { dateTime: start.format(), timeZone: tz },
      end: { dateTime: end.format(), timeZone: tz },
      reminders: {
        useDefault: false,
        overrides: [
          { method: "email", minutes: 60 },
          { method: "popup", minutes: 10 }
        ]
      }
    };

    if (doctorEmail && String(doctorEmail).includes("@")) {
      event.attendees = [{ email: doctorEmail }];
    }

    const calendarId = process.env.GOOGLE_CALENDAR_ID || "primary";

    const res = await calendar.events.insert({
      calendarId,
      resource: event,
      sendUpdates: event.attendees?.length ? "all" : "none"
    });

    console.log("Google Calendar (OAuth) event created:", res.data.htmlLink || res.data.id);
    return res.data;
  } catch (err) {
    console.error(
      "Google Calendar (OAuth) create error:",
      err?.response?.data || err?.message || err
    );
    return null;
  }
}

module.exports = { createCalendarEventUsingOAuth };
