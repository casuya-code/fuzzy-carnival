from __future__ import annotations

import logging
import smtplib
import ssl
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
    context = ssl.create_default_context()
    try:
        # M10: port 465 is implicit TLS; STARTTLS is only for submission ports.
        if SMTP_PORT == 465:
            server = smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=15, context=context)
        else:
            server = smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=15)
        with server as s:
            s.ehlo()
            if SMTP_PORT != 465 and SMTP_USE_TLS:
                # H8: verify the server certificate before sending credentials.
                s.starttls(context=context)
                s.ehlo()
            if SMTP_USER:
                s.login(SMTP_USER, SMTP_PASSWORD)
            s.send_message(msg)
        return True
    except Exception as e:
        # Never log the token or credentials; only the destination and error type.
        logger.warning(
            "Failed to send password reset email to %s: %s",
            to_email,
            type(e).__name__,
        )
        return False
