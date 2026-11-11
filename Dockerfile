# Lockbox mailbox backend. Put an authenticating HTTPS reverse proxy in front of it.
FROM node:22-alpine
WORKDIR /app
COPY connectors ./connectors
COPY server ./server
ENV LOCKBOX_DATA_DIR=/data PORT=3000
VOLUME ["/data"]
EXPOSE 3000
USER node
CMD ["node", "server/index.mjs"]
