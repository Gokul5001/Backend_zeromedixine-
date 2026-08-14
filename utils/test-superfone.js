// test-superfone.js
require('dotenv').config();
const { sendTemplateMessage } = require('../utils/superfone');

async function testSuperfone() {
  try {
    console.log('Testing Superfone API...');
    
    // Test with a simple template
    const result = await sendTemplateMessage({
      to: '916380085913', // Your test number
      templateName: 'test_template', // Use a simple template name for testing
      params: ['Test Name', 'Test Time', 'Test Concern'],
      language: 'en'
    });
    
    console.log('Test successful:', result);
  } catch (error) {
    console.error('Test failed:', error.message);
    console.error('Full error:', error);
  }
}

testSuperfone();