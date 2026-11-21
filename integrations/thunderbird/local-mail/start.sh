#!/bin/sh
set -eu
addgroup -g 60000 fixture
adduser -D -H -u 60000 -G fixture fixture
for user in 1 2; do
  for folder in cur new tmp; do
    mkdir -p "/mail/imap-$user/Maildir/$folder"
  done
  printf 'imap-%s:PUBLIC-SYNTHETIC-IMAP-%s\n' "$user" "$user"
done > /fixture/imap-users
chown -R 60000:60000 /mail
python3 /fixture/smtp.py &
exec dovecot -F -c /fixture/dovecot.conf
