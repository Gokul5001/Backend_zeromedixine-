// utils/googleTokens.js
const { google } = require('googleapis');
const Integration = require('../Models/Integration'); // path as needed
const fs = require('fs');

async function revokeRefreshToken(token) {
  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_OAUTH_CLIENT_ID,
      process.env.GOOGLE_OAUTH_CLIENT_SECRET
    );
    await oauth2Client.revokeToken(token);
    console.log('Google refresh token revoked');
    return true;
  } catch (err) {
    console.warn('Revoke failed:', err?.response?.data || err?.message || err);
    return false;
  }
}

/**
 * Replace the stored refresh token with a new one safely:
 * - store the new token
 * - test it by creating a tiny test event (no attendees) on the calendar
 * - if test succeeded, revoke the old token (optionally)
 */
async function rotateRefreshToken({ newToken, revokeOld = true }) {
  const INTEGRATION_KEY = 'google_calendar';
  const integration = await Integration.findOne({ key: INTEGRATION_KEY }) || new Integration({ key: INTEGRATION_KEY });
  const oldToken = integration.refreshToken || null;
  integration.refreshToken = newToken;
  integration.status = 'ok';
  integration.lastError = null;
  await integration.save();

  // quick test
  try {
    const oauth2Client = new google.auth.OAuth2(process.env.GOOGLE_OAUTH_CLIENT_ID, process.env.GOOGLE_OAUTH_CLIENT_SECRET);
    oauth2Client.setCredentials({ refresh_token: newToken });
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    const now = new Date();
    const res = await calendar.events.insert({
      calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',
      resource: {
        summary: 'Zeromedixine test event',
        start: { dateTime: new Date(now.getTime()+2*60*1000).toISOString() },
        end:   { dateTime: new Date(now.getTime()+17*60*1000).toISOString() }
      },
      sendUpdates: 'none'
    });
    console.log('Rotate test OK', res.data && res.data.id);
  } catch (err) {
    integration.status = 'invalid';
    integration.lastError = String(err?.response?.data || err?.message || err);
    await integration.save();
    throw new Error('New refresh token failed test: ' + integration.lastError);
  }

  // revoke old token optionally
  if (revokeOld && oldToken) {
    await revokeRefreshToken(oldToken);
  }

  return true;
}

module.exports = { revokeRefreshToken, rotateRefreshToken };
