const axios = require('axios');

// Send OTP email via Brevo
async function sendOtpEmail(to, code) {
  const expiry = process.env.OTP_EXPIRY_MINUTES || 5;

  const senderEmail = (process.env.EMAIL_FROM || 'no-reply@yourdomain.com')
    .replace(/^["\s]*|["\s]*$/g, '');

  const subject = 'Your AgriClip Verification Code';
  const textContent = `Your verification code is ${code}. It expires in ${expiry} minutes.`;
  const htmlContent = `
      <div style="font-family: Arial, sans-serif; line-height: 1.6;">
        <h2>AgriClip Verification</h2>
        <p>Your verification code is:</p>
        <div style="font-size: 24px; font-weight: bold; letter-spacing: 4px;">${code}</div>
        <p>This code will expire in <strong>${expiry} minutes</strong>.</p>
        <p>If you did not request this code, you can ignore this email.</p>
      </div>
    `;

  const payload = {
    sender: { email: senderEmail, name: 'AgriClip' },
    to: [{ email: to }],
    subject,
    textContent,
    htmlContent
  };

  await axios.post('https://api.brevo.com/v3/smtp/email', payload, {
    headers: {
      'api-key': process.env.BREVO_API_KEY,
      'Content-Type': 'application/json'
    },
    timeout: 10000
  });
}

module.exports = { sendOtpEmail };
