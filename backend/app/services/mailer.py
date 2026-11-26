from __future__ import annotations

import logging
import smtplib
from email.message import EmailMessage

from app.config import SMTP_FROM, SMTP_HOST, SMTP_PASSWORD, SMTP_PORT, SMTP_USE_TLS, SMTP_USER

logger = logging.getLogger(__name__)


def smtp_configured() -> bool:
    return bool(SMTP_HOST and SMTP_FROM)


def send_password_reset_email(to_email: str, reset_token: str) -> bool:
    if not smtp_configured():
        return False
    msg = EmailMessage()
    msg["Subject"] = "Reset your Yakodonyo password"
    msg["From"] = SMTP_FROM
    msg["To"] = to_email
    msg.set_content(
        "A password reset was requested for your account.\n\n"
        f"Reset token: {reset_token}\n\n"
        "If you did not request this, you can ignore this message."
    )
    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=15) as s:
            if SMTP_USE_TLS:
                s.starttls()
            if SMTP_USER:
                s.login(SMTP_USER, SMTP_PASSWORD)
            s.send_message(msg)
        return True
    except Exception as e:
        logger.warning("Failed to send password reset email to %s: %s", to_email, e)
        return False
