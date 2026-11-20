FROM alpine:3.21
RUN apk add --no-cache dovecot py3-aiosmtpd
COPY dovecot.conf smtp.py start.sh /fixture/
EXPOSE 1993 1587
ENTRYPOINT ["/bin/sh", "/fixture/start.sh"]
