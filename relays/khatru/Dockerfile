# Build the relay from source; the runtime image only carries the binary.
FROM golang:1.25-bookworm AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY main.go ./
RUN CGO_ENABLED=1 go build -trimpath -o /khatru .

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /khatru /usr/local/bin/khatru
ENV DATA_PATH=/data PORT=3334 HOST=0.0.0.0
EXPOSE 3334
CMD ["khatru"]
