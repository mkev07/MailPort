import asyncio
from mailbox import Maildir
import os
from pathlib import Path
import ssl

from aiosmtpd.smtp import AuthResult, LoginPassword, SMTP

USERS = {
    f"smtp-{index}".encode(): f"PUBLIC-SYNTHETIC-SMTP-{index}".encode()
    for index in (1, 2)
}
MAILBOXES = {
    f"synthetic-{index}@example.com": Path(f"/mail/imap-{index}/Maildir")
    for index in (1, 2)
}


def authenticate(server, session, envelope, mechanism, auth_data):
    if isinstance(auth_data, LoginPassword) and USERS.get(auth_data.login) == auth_data.password:
        return AuthResult(success=True, auth_data=auth_data.login)
    return AuthResult(success=False, handled=False)


class Delivery:
    async def handle_RCPT(self, server, session, envelope, address, rcpt_options):
        if address not in MAILBOXES:
            return "550 Unknown fixture recipient"
        envelope.rcpt_tos.append(address)
        return "250 Accepted"

    async def handle_DATA(self, server, session, envelope):
        for recipient in envelope.rcpt_tos:
            mailbox = Maildir(MAILBOXES[recipient])
            mailbox.add(envelope.original_content)
            mailbox.close()
        return "250 Delivered"


async def main():
    certificate = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    certificate.load_cert_chain("/tls/server.pem", "/tls/server.key")
    # TLS material is loaded before the fixture drops privileges.
    os.umask(0o077)
    os.setgroups([])
    os.setgid(60000)
    os.setuid(60000)
    loop = asyncio.get_running_loop()
    async with await loop.create_server(
        lambda: SMTP(Delivery(), tls_context=certificate, require_starttls=True,
                     authenticator=authenticate, auth_required=True, auth_require_tls=True),
        "0.0.0.0", 1587,
    ) as server:
        await server.serve_forever()


asyncio.run(main())
