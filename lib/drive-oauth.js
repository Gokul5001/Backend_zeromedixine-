// backend/lib/drive-oauth.js
const { google } = require('googleapis');
const stream = require('stream');
require('dotenv').config();

// NOTE: make sure this path matches your project (Models with capital M)
const Integration = require('../Models/Integration');

/**
 * Get an OAuth2 client configured with a refresh token from DB (integrations).
 * Falls back to process.env.GOOGLE_OAUTH_REFRESH_TOKEN if DB missing.
 */
async function getOAuth2Client() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Missing GOOGLE_OAUTH_CLIENT_ID or GOOGLE_OAUTH_CLIENT_SECRET in env');
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);

  // Try DB first
  try {
    const integration = await Integration.findOne({ key: 'google_calendar' });
    if (integration && integration.refreshToken) {
      oauth2Client.setCredentials({ refresh_token: integration.refreshToken });
      return oauth2Client;
    }
  } catch (dbErr) {
    // log but continue to fallback to env
    console.warn('drive-oauth: integration DB read failed, falling back to env refresh token:', dbErr && dbErr.message);
  }

  // Fallback to .env
  const envToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  if (envToken) {
    oauth2Client.setCredentials({ refresh_token: envToken });
    return oauth2Client;
  }

  throw new Error('No refresh token available (DB integration or env). Please add a refresh token.');
}

/**
 * Upload a Buffer to Google Drive using OAuth2 credentials (refresh token).
 * Returns the Drive file object (id, webViewLink, etc).
 */
async function uploadToDriveOAuth(buffer, filename, mimeType = 'application/pdf', folderId = null) {
  // create readable stream from buffer
  const bufferStream = new stream.PassThrough();
  bufferStream.end(buffer);

  // get oauth2 client (will throw if no token)
  const oauth2Client = await getOAuth2Client();
  const drive = google.drive({ version: 'v3', auth: oauth2Client });

  const fileMetadata = { name: filename };
  if (folderId) fileMetadata.parents = [folderId];

  try {
    const upload = await drive.files.create({
      requestBody: fileMetadata,
      media: { mimeType, body: bufferStream },
      fields: 'id, webViewLink',
    });

    // Optional: set file permission so anyone with link can view
    try {
      await drive.permissions.create({
        fileId: upload.data.id,
        requestBody: { type: 'anyone', role: 'reader' },
      });
    } catch (permErr) {
      // permission change may fail (e.g. domain policies); log and continue
      console.warn('drive-oauth: permissions.create failed (non-fatal):', permErr && (permErr.message || permErr));
    }

    return upload.data;
  } catch (err) {
    // Improve error message for common cause: insufficient scopes
    const errData = err?.response?.data || err?.message || err;
    console.error('drive-oauth: upload error:', errData);

    // Helpful hint for insufficient scopes
    const msg = (errData && errData.error && errData.error.message) || String(errData);
    if (/insufficient authentication scopes/i.test(msg) || /insufficientPermissions/i.test(msg)) {
      const hint = 'Google API error: insufficient authentication scopes. Re-authorize your OAuth client with Drive scopes (e.g. https://www.googleapis.com/auth/drive.file or https://www.googleapis.com/auth/drive) and update the refresh token in integrations collection or env.';
      console.error('drive-oauth hint:', hint);
      // attach hint to thrown error for caller
      const wrapped = new Error(`Drive upload failed: ${msg} — ${hint}`);
      wrapped.original = err;
      throw wrapped;
    }

    // rethrow original error otherwise
    throw err;
  }
}

module.exports = { uploadToDriveOAuth, getOAuth2Client };
