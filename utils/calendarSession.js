const { google } = require("googleapis");
const moment = require("moment-timezone");

async function createSessionCalendarEventOAuth(sessionData, doctorEmail) {
  try {
    if (
      !process.env.GOOGLE_OAUTH_CLIENT_ID ||
      !process.env.GOOGLE_OAUTH_CLIENT_SECRET ||
      !process.env.GOOGLE_OAUTH_REFRESH_TOKEN_CAL
    ) {
      console.warn("Session calendar: OAuth config missing — skipping");
      return null;
    }

    if (!sessionData?.date || !sessionData?.time) {
      console.warn("Session calendar: missing date/time — skipping");
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

    let start = moment.tz(
      `${sessionData.date} ${sessionData.time}`,
      ["YYYY-MM-DD HH:mm:ss", "YYYY-MM-DD HH:mm"],
      tz
    );

    if (!start.isValid()) {
      console.warn("Session calendar: invalid datetime", sessionData.date, sessionData.time);
      return null;
    }

    const end = start.clone().add(sessionData.duration || 30, "minutes");

    const event = {
      summary: `Therapy Session — ${sessionData.patientName || "Patient"}`,
      description:
        `Patient: ${sessionData.patientName || ""}\n` +
        `Concern: ${sessionData.concern || ""}\n` +
        `Session: ${sessionData.sessionIndex || ""}`,
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

    if (doctorEmail && doctorEmail.includes("@")) {
      event.attendees = [{ email: doctorEmail }];
    }

    const res = await calendar.events.insert({
      calendarId: process.env.GOOGLE_CALENDAR_ID || "primary",
      resource: event,
      sendUpdates: event.attendees?.length ? "all" : "none"
    });

    console.log("Session calendar event created:", res.data.id);
    return res.data;

  } catch (err) {
    console.error(
      "Session calendar create error:",
      err?.response?.data || err?.message || err
    );
    return null;
  }
}

module.exports = { createSessionCalendarEventOAuth };
