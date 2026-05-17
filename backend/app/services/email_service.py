import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from app.core.config import get_settings


def send_interview_email(to_email: str, candidate_name: str, job_title: str, interview_link: str) -> None:
    settings = get_settings()
    recipient = to_email.strip()

    if not settings.smtp_host or not settings.smtp_username or not settings.smtp_password or not settings.smtp_from_email:
        raise ValueError("SMTP configuration is incomplete")
    if not recipient or "@" not in recipient:
        raise ValueError("Recipient email is invalid")
    if settings.smtp_use_ssl and settings.smtp_use_tls:
        raise ValueError("Use either SMTP_USE_SSL=true or SMTP_USE_TLS=true, not both")

    msg = MIMEMultipart("alternative")
    msg["Subject"] = f"Interview Invitation - {job_title}"
    msg["From"] = f"{settings.smtp_from_name} <{settings.smtp_from_email}>"
    msg["To"] = recipient

    text = f"""Interview Invitation

Hi {candidate_name},

You are shortlisted for the {job_title} role.
Please start your AI interview using the secure link below:
{interview_link}

Interview instructions:
- Use Chrome/Edge (latest version)
- Keep camera and microphone enabled
- Sit in a quiet place with stable internet
- Link is unique and should not be shared

Best,
{settings.smtp_from_name}
"""

    html = f"""
    <html>
      <body style="margin:0;padding:0;background:#0b1020;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#0b1020;padding:24px 0;">
          <tr>
            <td align="center">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:620px;background:#0f1730;border:1px solid #223050;border-radius:16px;overflow:hidden;font-family:Segoe UI,Arial,sans-serif;color:#d7e3ff;">
                <tr>
                  <td style="padding:24px 28px;background:linear-gradient(135deg,#162347,#0f1730);border-bottom:1px solid #223050;">
                    <p style="margin:0;font-size:12px;letter-spacing:1.5px;color:#95a7d4;text-transform:uppercase;">Kovidam AI Interviews</p>
                    <h1 style="margin:10px 0 0 0;font-size:28px;line-height:1.2;color:#f7fbff;">Interview Invitation</h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding:24px 28px;">
                    <p style="margin:0 0 12px 0;font-size:17px;line-height:1.6;">Hi {candidate_name},</p>
                    <p style="margin:0 0 16px 0;font-size:16px;line-height:1.7;color:#b7c5ea;">
                      You are shortlisted for the <strong style="color:#ffffff;">{job_title}</strong> role.
                      Your AI interview is ready.
                    </p>
                    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 20px 0;">
                      <tr>
                        <td style="border-radius:10px;background:#23d4b4;">
                          <a href="{interview_link}" style="display:inline-block;padding:12px 20px;color:#02131a;text-decoration:none;font-weight:700;font-size:15px;">
                            Start Interview
                          </a>
                        </td>
                      </tr>
                    </table>

                    <p style="margin:0 0 8px 0;font-size:14px;font-weight:600;color:#f1f5ff;">Before you begin</p>
                    <ul style="margin:0 0 18px 18px;padding:0;color:#b7c5ea;font-size:14px;line-height:1.7;">
                      <li>Use latest Chrome or Edge browser</li>
                      <li>Keep camera and microphone enabled</li>
                      <li>Sit in a quiet place with stable internet</li>
                      <li>This link is unique and should not be shared</li>
                    </ul>

                    <p style="margin:0 0 8px 0;font-size:13px;color:#95a7d4;">If the button does not work, use this link:</p>
                    <p style="margin:0;padding:10px 12px;border:1px solid #223050;border-radius:10px;background:#0a1228;word-break:break-all;font-size:13px;color:#bcd0ff;">
                      {interview_link}
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:16px 28px;border-top:1px solid #223050;color:#8fa3d4;font-size:12px;">
                    This is an automated interview invitation from {settings.smtp_from_name}.
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
    """

    msg.attach(MIMEText(text, "plain"))
    msg.attach(MIMEText(html, "html"))

    try:
        if settings.smtp_use_ssl:
            with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=20) as server:
                server.login(settings.smtp_username, settings.smtp_password)
                server.sendmail(settings.smtp_from_email, [recipient], msg.as_string())
            return

        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as server:
            server.ehlo()
            if settings.smtp_use_tls:
                server.starttls()
                server.ehlo()
            server.login(settings.smtp_username, settings.smtp_password)
            server.sendmail(settings.smtp_from_email, [recipient], msg.as_string())
    except smtplib.SMTPException as exc:
        raise RuntimeError(f"SMTP send failed: {exc}") from exc
