"""File CH-05's copies of sent outreach under Sent, not the Inbox.

n8n sends over SMTP, and SMTP never writes a copy into the Sent folder - only
a mail client does that. So CH-05 BCCs every message to our own mailbox, which
is the only way the owner can read what actually went out. But a BCC arrives
as new mail, so it landed in the Inbox, mixed in with the replies that matter.

This moves it: every message in INBOX whose From is our own address is
copied to Sent (marked read) and then removed from INBOX. DMARC aggregate
reports go the same way into a DMARC folder. Nothing else is touched -
replies and bounce reports come from other addresses.

The mail server this was written against has no IMAP MOVE and rejects
sub-addresses (a +sent@ address bounced: "Could not accept message for
recipient with sub-address"), so this is COPY, then flag \\Deleted, then EXPUNGE. EXPUNGE
removes every \\Deleted message in the folder, so it only runs when the
only \\Deleted messages are the ones this just copied; anything else
flagged (say, by a mail app mid-delete) is left alone and this tries again
next round.

Runs as the clienthunt-mail-filer container (deploy/docker-compose.yml):

    python file_sent_copies.py --every 300     # forever, every 5 minutes
    python file_sent_copies.py --dry-run       # once, only report

Needs IMAP_HOST, IMAP_PORT, OUTREACH_USER, OUTREACH_PASSWORD - and nothing
else from .env.
"""

import email
import email.utils
import imaplib
import os
import sys
import time


def stamp():
    return time.strftime('%Y-%m-%d %H:%M:%S')


def where_to(from_addr, subject, user):
    """The folder a message in INBOX belongs in, or None to leave it."""
    if from_addr == user:
        return 'Sent'                      # our own BCC copy of an outreach email
    # DMARC aggregate reports (if the domain's DMARC record sends rua= reports
    # to this mailbox): one zip a day from each of Google, Yahoo, Microsoft. Useful, but not mail anyone
    # needs to see among the replies.
    # Both conditions: a person whose address happens to contain "dmarc"
    # writes "Re: ...", never "Report domain: ...", so a reply is never hidden.
    if subject.strip().lower().startswith('report domain:') and 'dmarc' in from_addr:
        return 'DMARC'
    return None


def file_once(dry_run=False):
    user = os.environ['OUTREACH_USER'].strip().lower()
    m = imaplib.IMAP4_SSL(os.environ['IMAP_HOST'], int(os.environ.get('IMAP_PORT') or 993), timeout=60)
    try:
        m.login(os.environ['OUTREACH_USER'], os.environ['OUTREACH_PASSWORD'])
        m.select('INBOX', readonly=dry_run)

        typ, data = m.uid('SEARCH', None, 'UNDELETED')
        if typ != 'OK':
            raise RuntimeError(f'search failed: {data}')

        plan = {}                          # folder -> [uid, ...]
        for uid in data[0].split():
            typ, hdr = m.uid('FETCH', uid, '(BODY.PEEK[HEADER.FIELDS (FROM SUBJECT)])')
            if typ != 'OK' or not hdr or not isinstance(hdr[0], tuple):
                continue
            msg = email.message_from_bytes(hdr[0][1])
            from_addr = email.utils.parseaddr(msg.get('From', ''))[1].lower()
            folder = where_to(from_addr, str(msg.get('Subject', '')), user)
            if folder:
                plan.setdefault(folder, []).append(uid)

        if not plan:
            return 0
        summary = ', '.join(f'{len(u)} to {f}' for f, u in plan.items())
        if dry_run:
            print(f'{stamp()} would file {summary}', flush=True)
            return sum(len(u) for u in plan.values())

        existing = {line.decode().rsplit(' "/" ', 1)[-1].strip('"') for line in (m.list()[1] or []) if line}
        moved = []
        for folder, uids in plan.items():
            if folder not in existing:
                m.create(folder)
            uid_set = b','.join(uids).decode()
            # Read first, so the filed copies are not bold.
            m.uid('STORE', uid_set, '+FLAGS.SILENT', r'(\Seen)')
            typ, data = m.uid('COPY', uid_set, folder)
            if typ != 'OK':
                raise RuntimeError(f'copy to {folder} failed, nothing removed: {data}')
            m.uid('STORE', uid_set, '+FLAGS.SILENT', r'(\Deleted)')
            moved += uids

        typ, data = m.uid('SEARCH', None, 'DELETED')
        flagged = set(data[0].split()) if typ == 'OK' else None
        if flagged is not None and flagged <= set(moved):
            m.expunge()
            print(f'{stamp()} filed {summary}', flush=True)
        else:
            print(f'{stamp()} copied {summary}; Inbox holds other deleted mail, '
                  f'so the originals are left flagged until next round', flush=True)
        return len(moved)
    finally:
        try:
            m.logout()
        except Exception:
            pass


def main(argv):
    if '--dry-run' in argv:
        file_once(dry_run=True)
        return
    every = int(argv[argv.index('--every') + 1]) if '--every' in argv else 0
    while True:
        try:
            file_once()
        except Exception as e:  # a mailbox hiccup must not stop the loop
            print(f'{stamp()} skipped this round: {e}', flush=True)
        if not every:
            return
        time.sleep(every)


if __name__ == '__main__':
    main(sys.argv[1:])
