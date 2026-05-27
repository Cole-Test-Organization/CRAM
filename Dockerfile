# ---- Stage 1: Build GUI ----
FROM node:22-slim AS gui-build
WORKDIR /app/gui
COPY gui/package.json gui/package-lock.json ./
RUN npm ci
COPY gui/ ./
RUN npm run build
# Output: /app/api/public/

# ---- Stage 2: Production ----
FROM node:22-slim AS production

# Chromium for Puppeteer (used by outreach + events scrapers), plus
# postgresql-client-16 matching the postgres:16-alpine db image (server-version-
# matching pg_dump is the only supported config — older pg_dump against a newer
# server can fail on newly-introduced syntax). PGDG repo provides
# postgresql-client-16 on bookworm.
#
# Using the apt-installed Chromium (not Puppeteer's bundled binary) so the
# browser arch always matches the base image — works on arm64 (Mac), amd64
# (Linux), and either via WSL2 (Windows). PUPPETEER_SKIP_DOWNLOAD below tells
# npm install to skip the bundled-Chromium download in both packages.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates chromium wget curl gnupg \
    && install -d /usr/share/postgresql-common/pgdg \
    && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /etc/apt/trusted.gpg.d/postgresql.gpg \
    && echo "deb https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update && apt-get install -y --no-install-recommends postgresql-client-16 \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app/api
COPY api/package.json api/package-lock.json ./
RUN npm ci --omit=dev
COPY api/src/ ./src/
COPY api/migrations/ ./migrations/
COPY tools/ /app/tools/
COPY todoist/package.json todoist/package-lock.json /app/todoist/
RUN cd /app/todoist && npm ci --omit=dev
COPY todoist/src/ /app/todoist/src/
COPY outreach/package.json outreach/package-lock.json /app/outreach/
RUN cd /app/outreach && npm ci --omit=dev
COPY outreach/src/ /app/outreach/src/
# Events module reuses puppeteer. No lockfile yet — using `npm install` instead
# of `npm ci` until the deps stabilize and we can commit one.
COPY events/package.json /app/events/
RUN cd /app/events && npm install --omit=dev
COPY events/src/ /app/events/src/
COPY --from=gui-build /app/api/public ./public/

ENV HOST=0.0.0.0
ENV PORT=3200
ENV MCP_HOST=0.0.0.0
ENV MCP_PORT=3100
EXPOSE 3200 3100

COPY scripts/docker-entrypoint.prod.sh /app/docker-entrypoint.prod.sh
RUN chmod +x /app/docker-entrypoint.prod.sh

CMD ["/app/docker-entrypoint.prod.sh"]

# ---- Stage 3: Development ----
FROM node:22-slim AS dev

# Chromium for Puppeteer + postgresql-client-16 (matches the postgres:16-alpine
# db image — see the production stage comment for the rationale on both).
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates chromium wget curl gnupg \
    && install -d /usr/share/postgresql-common/pgdg \
    && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /etc/apt/trusted.gpg.d/postgresql.gpg \
    && echo "deb https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update && apt-get install -y --no-install-recommends postgresql-client-16 \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

RUN npm install -g nodemon

# Install API deps
WORKDIR /app/api
COPY api/package.json api/package-lock.json ./
RUN npm ci

# Install GUI deps
WORKDIR /app/gui
COPY gui/package.json gui/package-lock.json ./
RUN npm ci

# Install outreach deps (puppeteer JS only; chromium is the apt-installed one)
COPY outreach/package.json outreach/package-lock.json /app/outreach/
RUN cd /app/outreach && npm ci

# Install events scraper deps
COPY events/package.json /app/events/
RUN cd /app/events && npm install

# Copy source (will be overridden by volume mounts in dev)
WORKDIR /app/api
COPY api/src/ ./src/

# Install todoist deps
COPY todoist/package.json todoist/package-lock.json /app/todoist/
RUN cd /app/todoist && npm ci

COPY tools/ /app/tools/
COPY todoist/src/ /app/todoist/src/
COPY outreach/src/ /app/outreach/src/
COPY events/src/ /app/events/src/

WORKDIR /app/gui
COPY gui/ ./

WORKDIR /app

ENV HOST=0.0.0.0
ENV PORT=3200
EXPOSE 3200 80

COPY scripts/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

CMD ["/app/docker-entrypoint.sh"]
