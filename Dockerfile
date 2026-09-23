# ============================================================
# MOIL Intelligence — production container (multi-stage)
# Build:  docker build -t moil-intelligence .
# Run:    docker compose up -d   (see docker-compose.yml)
# ============================================================

# ---------- deps + build ----------
FROM oven/bun:1 AS builder
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY prisma ./prisma
RUN bunx prisma generate

COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# DATABASE_URL at build time is only a placeholder — real one injected at runtime
ENV DATABASE_URL="file:/app/db/custom.db"
RUN bun run lint && bun run build

# ---------- runtime ----------
FROM oven/bun:1-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/models ./models
COPY --from=builder /app/research/multi-mine/artifacts ./research/multi-mine/artifacts
COPY --from=builder /app/scripts ./scripts

# SQLite mode (default): mount ./db as a volume. Postgres mode: change
# DATABASE_URL + prisma provider — see DEPLOY_GUIDE.md section 3.
VOLUME ["/app/db"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD bun -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["sh", "-c", "bunx prisma db push --skip-generate && bun run start"]
