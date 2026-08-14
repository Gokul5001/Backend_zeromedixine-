// backend/test-upload-drive-oauth.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { uploadToDriveOAuth } = require('./lib/drive-oauth');

async function runTest() {
  try {
    // sample PDF - create tiny one if not present
    const samplePath = path.join(__dirname, 'sample.pdf');
    if (!fs.existsSync(samplePath)) {
      fs.writeFileSync(samplePath, '%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF');
    }

  const buffer = fs.readFileSync(path.join(__dirname, 'test.pdf'));
const filename = `real_pdf_test_${Date.now()}.pdf`;

    console.log('Uploading sample as', filename);

    const result = await uploadToDriveOAuth(buffer, filename, 'application/pdf', process.env.GOOGLE_DRIVE_FOLDER_ID || null);
    console.log('Upload successful!');
    console.log('File ID:', result.id);
    console.log('webViewLink: https://drive.google.com/file/d/' + result.id + '/view');
  } catch (err) {
    console.error('Upload failed:', err.response && err.response.data ? err.response.data : err.message || err);
  }
}

runTest();
