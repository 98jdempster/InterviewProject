# Stage 1: Build
FROM golang:1.23-alpine AS build
RUN apk add --no-cache git
WORKDIR /app
COPY . .
RUN go mod tidy && CGO_ENABLED=0 GOOS=linux go build -o api .

# Stage 2: Run
FROM alpine:latest
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=build /app/api .
EXPOSE 8080
CMD ["./api"]
