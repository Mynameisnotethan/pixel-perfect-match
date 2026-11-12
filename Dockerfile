# Lockbox mailbox backend. Put an authenticating HTTPS reverse proxy in front of it.
FROM node:22-alpine
WORKDIR /app
# IMAP/SMTP libraries for mailboxes other than Gmail and Outlook.
COPY server/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund
COPY connectors ./connectors
COPY server ./server
# Provider credentials are added after deployment through the admin Setup page.
ENV LOCKBOX_DATA_DIR=/data PORT=3000
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]
EXPOSE 3000
USER node
CMD ["node", "server/index.mjs"]
