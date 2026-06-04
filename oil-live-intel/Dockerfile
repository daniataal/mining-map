# syntax=docker/dockerfile:1

# CI uses dannyatalla/oil-live-intel-base:latest (pre-downloaded modules). Local default: stock Go image.
ARG BASE_IMAGE=golang:1.23-alpine
FROM ${BASE_IMAGE} AS build
WORKDIR /src
RUN apk add --no-cache git

COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download

COPY . .
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -o /api ./cmd/api && \
    CGO_ENABLED=0 go build -o /worker ./cmd/worker && \
    CGO_ENABLED=0 go build -o /mcp ./cmd/mcp && \
    CGO_ENABLED=0 go build -o /search-indexer ./cmd/oil-live-search-indexer

FROM alpine:3.20
RUN apk add --no-cache ca-certificates wget
WORKDIR /app
COPY --from=build /api /app/api
COPY --from=build /worker /app/worker
COPY --from=build /mcp /app/mcp
COPY --from=build /search-indexer /app/search-indexer
EXPOSE 8095
ENTRYPOINT ["/app/api"]
