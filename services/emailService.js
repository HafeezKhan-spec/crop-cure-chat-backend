const nodemailer = require('nodemailer');

// Send OTP email via SMTP (Nodemailer)
async function sendOtpEmail(to, code) {
  const expiry = process.env.OTP_EXPIRY_MINUTES || 5;

  // Parse sender from EMAIL_FROM (e.g., "AgriClip <no-reply@domain.com>")
  const rawFrom = (process.env.EMAIL_FROM || 'AgriClip <no-reply@yourdomain.com>')
    .replace(/^["\s]*|["\s]*$/g, '');
  let senderName = 'AgriClip';
  let senderEmail = rawFrom;
  const match = rawFrom.match(/^(?:"?([^"<]*)"?\s*)?<([^>]+)>$/);
  if (match) {
    senderName = match[1]?.trim() || senderName;
    senderEmail = match[2].trim();
  }

  // Build SMTP config: prefer generic SMTP_* vars; fallback to Gmail app password
  const isGmailConfigured = !!(process.env.GMAIL_USER && process.env.GMAIL_PASS);
  const host = process.env.SMTP_HOST || (isGmailConfigured ? 'smtp.gmail.com' : undefined);
  const port = parseInt(process.env.SMTP_PORT || (isGmailConfigured ? '465' : '587'), 10);
  const secure = process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465;
  let user = process.env.SMTP_USER || process.env.GMAIL_USER;
  let pass = process.env.SMTP_PASS || process.env.GMAIL_PASS;

  if (!host || !user || !pass) {
    throw new Error('SMTP is not configured. Set SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS or GMAIL_USER/GMAIL_PASS in .env');
  }

  // Create transporter
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass }
  });

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

  await transporter.sendMail({
    from: `${senderName} <${senderEmail}>`,
    to,
    subject,
    text: textContent,
    html: htmlContent
  });
}

module.exports = { sendOtpEmail };
