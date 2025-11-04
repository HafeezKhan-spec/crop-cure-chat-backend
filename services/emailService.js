const nodemailer = require('nodemailer');

// Create a reusable transporter using Gmail SMTP
// Requires Gmail App Password for accounts with 2FA
// Explicit Gmail SMTP + STARTTLS (more reliable in hosted environments)
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,          // STARTTLS
  requireTLS: true,
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS
  },
  connectionTimeout: 10000,
  greetingTimeout: 5000
});

// Only verify in non-production to avoid startup delays/timeouts
if (process.env.NODE_ENV !== 'production') {
  transporter.verify((error, success) => {
    if (error) {
      console.warn('Nodemailer Gmail SMTP verification failed:', error.message);
    } else {
      console.log('Nodemailer Gmail SMTP transporter ready');
    }
  });
}

// Send OTP email
async function sendOtpEmail(to, code) {
  const expiry = process.env.OTP_EXPIRY_MINUTES || 5;
  const mailOptions = {
    from: process.env.GMAIL_USER,
    to,
    subject: 'Your AgriClip Verification Code',
    text: `Your verification code is ${code}. It expires in ${expiry} minutes.`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6;">
        <h2>AgriClip Verification</h2>
        <p>Your verification code is:</p>
        <div style="font-size: 24px; font-weight: bold; letter-spacing: 4px;">${code}</div>
        <p>This code will expire in <strong>${expiry} minutes</strong>.</p>
        <p>If you did not request this code, you can ignore this email.</p>
      </div>
    `
  };

  await transporter.sendMail(mailOptions);
}

module.exports = { sendOtpEmail };
