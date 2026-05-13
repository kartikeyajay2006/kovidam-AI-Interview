import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from app.core.config import get_settings


def send_interview_email(to_email: str, candidate_name: str, job_title: str, interview_link: str) -> None:
    settings = get_settings()

    if not settings.smtp_host or not settings.smtp_username or not settings.smtp_password or not settings.smtp_from_email:
        raise ValueError("SMTP configuration is incomplete")

    msg = MIMEMultipart("alternative")
    msg["Subject"] = f"Interview Invitation - {job_title}"
    msg["From"] = f"{settings.smtp_from_name} <{settings.smtp_from_email}>"
    msg["To"] = to_email

    html = f"""
    <html>
      <body style=\"font-family:Arial,sans-serif;\">
        <h2>Interview Invitation</h2>
        <p>Hi {candidate_name},</p>
        <p>You are invited for an AI interview for <b>{job_title}</b>.</p>
        <p>
          <a href=\"{interview_link}\" style=\"padding:10px 14px;background:#0ea5e9;color:#fff;text-decoration:none;border-radius:6px;\">Start Interview</a>
        </p>
        <p>If the button does not work, open this link:</p>
        <p>{interview_link}</p>
      </body>
    </html>
    """

    msg.attach(MIMEText(html, "html"))

    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as server:
        if settings.smtp_use_tls:
            server.starttls()
        server.login(settings.smtp_username, settings.smtp_password)
        server.sendmail(settings.smtp_from_email, [to_email], msg.as_string())
