# nak is built from source so the image is the same on amd64 and arm64; the runtime image carries node, jq and the binary.
FROM golang:1.27-alpine AS nak
ARG NAK_VERSION=v0.20.7
RUN apk add --no-cache git && CGO_ENABLED=0 go install -trimpath -ldflags "-s -w -X main.version=${NAK_VERSION}" github.com/fiatjaf/nak@${NAK_VERSION}

FROM node:24-alpine
RUN apk add --no-cache jq
COPY --from=nak /go/bin/nak /usr/local/bin/nak
WORKDIR /app
COPY package.json agent.js seed.js keys.js ./
ENV HOST=0.0.0.0 PORT=7790 IDENTITIES_DIR=/identities NODE_ENV=production
USER node
EXPOSE 7790
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD node -e "fetch('http://127.0.0.1:7790/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "agent.js"]
