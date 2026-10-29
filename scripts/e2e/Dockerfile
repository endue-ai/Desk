# The runtime e2e dependencies on Playwright's Linux image (ADR 0018). scripts/e2e.mjs builds it from the
# repository's manifests only, tags it with their hash and copies the source in at run time, so a code
# change never rebuilds it and a lockfile change always does. Never pushed anywhere.
ARG PLAYWRIGHT_VERSION
FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble

ARG PNPM_VERSION
RUN npm install --global --no-fund --no-audit "pnpm@${PNPM_VERSION}"

WORKDIR /work
COPY . .
RUN pnpm install --frozen-lockfile
