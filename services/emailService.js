const nodemailer = require('nodemailer');

// Create a reusable transporter using explicit Gmail SMTP settings
// Requires Gmail App Password (no spaces) for accounts with 2FA
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '465', 10),
  secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : true,
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS
  },
  pool: true,
  connectionTimeout: parseInt(process.env.SMTP_CONNECTION_TIMEOUT || '10000', 10),
  socketTimeout: parseInt(process.env.SMTP_SOCKET_TIMEOUT || '10000', 10)
});

// Verify transporter configuration on startup (optional in production)
transporter.verify(function(error, success) {
  if (error) {
    console.warn('Nodemailer SMTP transporter verification failed:', error.message);
  } else {
    console.log('Nodemailer SMTP transporter ready');
  }
});

// Send OTP email
async function sendOtpEmail(to, code) {
  const mailOptions = {
    from: process.env.GMAIL_USER,
    to,
    subject: 'Your AgriClip Verification Code',
    text: `Your verification code is ${code}. It expires in 5 minutes.`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6;">
        <h2>AgriClip Verification</h2>
        <p>Your verification code is:</p>
        <div style="font-size: 24px; font-weight: bold; letter-spacing: 4px;">${code}</div>
        <p>This code will expire in <strong>10 minutes</strong>.</p>
        <p>If you did not request this code, you can ignore this email.</p>
      </div>
    `
  };

  await transporter.sendMail(mailOptions);
}

module.exports = { sendOtpEmail };