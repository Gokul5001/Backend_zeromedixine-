// utils/zoom-s2s-helper.js
const axios = require("axios");

// Use the Zoom Server-to-Server OAuth / account_credentials flow.
// Put these in your .env (do NOT commit .env)
const ZOOM_S2S_CLIENT_ID = process.env.ZOOM_S2S_CLIENT_ID;
const ZOOM_S2S_CLIENT_SECRET = process.env.ZOOM_S2S_CLIENT_SECRET;
const ZOOM_S2S_ACCOUNT_ID = process.env.ZOOM_S2S_ACCOUNT_ID; // required by Zoom for account_credentials

if (!ZOOM_S2S_CLIENT_ID || !ZOOM_S2S_CLIENT_SECRET || !ZOOM_S2S_ACCOUNT_ID) {
  // we don't throw here so local dev without S2S still works if you want to keep manual token
  // but it's helpful to warn.
  console.warn("zoom-s2s-helper: missing S2S env vars (ZOOM_S2S_CLIENT_ID / ZOOM_S2S_CLIENT_SECRET / ZOOM_S2S_ACCOUNT_ID)");
}

let cache = {
  token: null,
  expiresAt: 0, // ms epoch
};

async function fetchNewToken() {
  if (!ZOOM_S2S_CLIENT_ID || !ZOOM_S2S_CLIENT_SECRET || !ZOOM_S2S_ACCOUNT_ID) {
    throw new Error("Missing Zoom S2S credentials in env");
  }

  // Zoom expects Basic auth with clientId:clientSecret
  const basic = Buffer.from(`${ZOOM_S2S_CLIENT_ID}:${ZOOM_S2S_CLIENT_SECRET}`).toString("base64");

  const url = `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(ZOOM_S2S_ACCOUNT_ID)}`;

  const resp = await axios.post(url, null, {
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    timeout: 10000,
  });

  const d = resp.data;
  if (!d || !d.access_token) throw new Error("Invalid token response from Zoom S2S");

  // expires_in is seconds — create a slight buffer
  const expiresInSec = Number(d.expires_in || 3600);
  const expiresAt = Date.now() + (expiresInSec - 30) * 1000; // subtract 30s buffer

  cache.token = d.access_token;
  cache.expiresAt = expiresAt;

  console.log("zoom-s2s-helper: fetched new S2S token, expires_in:", expiresInSec);
  return cache.token;
}

async function getZoomS2SToken() {
  // If token present and not near expiry, reuse it
  if (cache.token && Date.now() < cache.expiresAt) return cache.token;
  return await fetchNewToken();
}

module.exports = { getZoomS2SToken, _cache: cache };
