FROM golang:1.23-alpine AS build
WORKDIR /src
RUN apk add --no-cache git
COPY go.mod ./
COPY . .
RUN go mod tidy && \
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
