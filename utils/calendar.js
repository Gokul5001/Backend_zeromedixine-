// utils/calendar.js
const { google } = require('googleapis');
const Integration = require('../Models/Integration');

async function createCalendarEventOAuth(appointment, doctorEmail) {
  // load refresh token from DB
  const integration = await Integration.findOne({ key: 'google_calendar' });
  if (!integration || !integration.refreshToken) {
    console.warn('No refresh token stored; skipping calendar event.');
    return null;
  }

  const oauth2Client = new google.auth.OAuth2(process.env.GOOGLE_OAUTH_CLIENT_ID, process.env.GOOGLE_OAUTH_CLIENT_SECRET);
  oauth2Client.setCredentials({ refresh_token: integration.refreshToken });

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
  // build event (same as earlier)
  const tz = process.env.GOOGLE_CALENDAR_TZ || 'Asia/Kolkata';
  const moment = require('moment-timezone');
  const dateStr = appointment.appointment_date || appointment.date;
  const timeStr = appointment.appointment_time || appointment.time;
  if (!dateStr || !timeStr) return null;
  let start = moment.tz(`${dateStr} ${timeStr}`, 'YYYY-MM-DD HH:mm:ss', tz);
  if (!start.isValid()) start = moment.tz(`${dateStr} ${timeStr}`, 'YYYY-MM-DD HH:mm', tz);
  if (!start.isValid()) start = moment.tz(`${dateStr}T${timeStr}`, tz);
  if (!start.isValid()) return null;
  const end = start.clone().add(30, 'minutes');

  const event = {
    summary: `Consult — ${appointment.name || 'Patient'}`,
    description: `Patient: ${appointment.name || ''}\nPhone: ${appointment.phone || ''}`,
    start: { dateTime: start.format(), timeZone: tz },
    end: { dateTime: end.format(), timeZone: tz }
  };
  if (doctorEmail && doctorEmail.includes('@')) event.attendees = [{ email: doctorEmail }];

  try {
    const res = await calendar.events.insert({
      calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',
      resource: event,
      sendUpdates: event.attendees && event.attendees.length ? 'all' : 'none'
    });
    return res.data;
  } catch (err) {
    // handle auth failures explicitly
    const errData = err?.response?.data || err?.message || String(err);
    console.error('Calendar create error:', errData);

    // detect invalid_grant -> token expired/revoked
    const message = (errData && errData.error_description) || (errData && errData.error && errData.error.message) || String(errData);
    if (/invalid_grant|Token has been expired or revoked/i.test(message)) {
      // mark integration invalid and notify admin (you can also send WA/Email here)
      if (integration) {
        integration.status = 'invalid';
        integration.lastError = message;
        await integration.save();
      }
    }
    throw err; // rethrow to let caller know
  }
}

module.exports = { createCalendarEventOAuth };

