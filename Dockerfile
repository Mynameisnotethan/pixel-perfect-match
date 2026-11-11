# Lockbox mailbox backend. Put an authenticating HTTPS reverse proxy in front of it.
FROM node:22-alpine
WORKDIR /app
COPY connectors ./connectors
COPY server ./server
# The publisher's public Outlook client (device-code sign-in). Not a secret.
ARG LOCKBOX_MS_DEVICE_CLIENT_ID=
ENV LOCKBOX_DATA_DIR=/data PORT=3000 LOCKBOX_MS_DEVICE_CLIENT_ID=$LOCKBOX_MS_DEVICE_CLIENT_ID
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]
EXPOSE 3000
USER node
CMD ["node", "server/index.mjs"]
