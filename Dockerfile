# Lockbox mailbox backend. Put an authenticating HTTPS reverse proxy in front of it.
FROM node:22-alpine
WORKDIR /app
COPY connectors ./connectors
COPY server ./server
# Provider credentials are added after deployment through the admin Setup page.
ENV LOCKBOX_DATA_DIR=/data PORT=3000
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]
EXPOSE 3000
USER node
CMD ["node", "server/index.mjs"]
