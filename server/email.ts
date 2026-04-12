import nodemailer from "nodemailer";

const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const APP_URL = process.env.APP_URL || "https://app.thevisualsitemap.com";

const transporter = SMTP_USER
  ? nodemailer.createTransport({
      service: "gmail",
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    })
  : null;

export async function sendVerificationEmail(email: string, name: string, token: string): Promise<void> {
  const verifyUrl = `${APP_URL}/#/verify/${token}`;

  if (!transporter) {
    console.log(`[EMAIL] Verification link for ${email}: ${verifyUrl}`);
    return;
  }

  await transporter.sendMail({
    from: `"The Visual Sitemapper" <${SMTP_USER}>`,
    to: email,
    subject: "Verify your email — The Visual Sitemapper",
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
        <h2 style="color: #1a1a2e; margin-bottom: 8px;">Welcome, ${name}!</h2>
        <p style="color: #555; line-height: 1.6;">
          Thanks for signing up for The Visual Sitemapper. Please verify your email address to get started.
        </p>
        <a href="${verifyUrl}" style="display: inline-block; background: linear-gradient(135deg, #3b82f6, #06b6d4); color: white; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; margin: 24px 0;">
          Verify Email
        </a>
        <p style="color: #999; font-size: 13px; margin-top: 32px;">
          If you didn't create an account, you can safely ignore this email.
        </p>
      </div>
    `,
  });
}

export async function sendPasswordResetEmail(email: string, name: string, token: string): Promise<void> {
  const resetUrl = `${APP_URL}/#/reset-password?token=${token}`;

  if (!transporter) {
    console.log(`[EMAIL] Password reset link for ${email}: ${resetUrl}`);
    return;
  }

  await transporter.sendMail({
    from: `"The Visual Sitemapper" <${SMTP_USER}>`,
    to: email,
    subject: "Reset your password — The Visual Sitemapper",
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
        <h2 style="color: #1a1a2e; margin-bottom: 8px;">Password Reset</h2>
        <p style="color: #555; line-height: 1.6;">
          Hi ${name}, we received a request to reset your password. Click the button below to set a new one.
        </p>
        <a href="${resetUrl}" style="display: inline-block; background: linear-gradient(135deg, #3b82f6, #06b6d4); color: white; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; margin: 24px 0;">
          Reset Password
        </a>
        <p style="color: #999; font-size: 13px; margin-top: 32px;">
          This link expires in 1 hour. If you didn't request a reset, ignore this email.
        </p>
      </div>
    `,
  });
}
