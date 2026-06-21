# syntax=docker/dockerfile:1
# Built from the REPO ROOT context (pnpm workspace). CI runs `pnpm run generate`
# first so packages/api-client/{openapi.json,src/schema.d.ts} exist in the context.
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

FROM base AS build
ARG NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
# Basemap (Phase 3a): Next inlines NEXT_PUBLIC_* into the client bundle at build time.
# The style URL is the only basemap build-arg now — the planet is served as z/x/y tiles by the
# go-pmtiles tile server (fountainrank.com/tiles), referenced from inside the style JSON.
ARG NEXT_PUBLIC_BASEMAP_STYLE_URL
ENV NEXT_PUBLIC_BASEMAP_STYLE_URL=$NEXT_PUBLIC_BASEMAP_STYLE_URL
# Manifests first for layer caching. All workspace package.json files are needed
# for pnpm to resolve the frozen lockfile graph.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/api-client/package.json packages/api-client/
COPY web/package.json web/
COPY mobile/package.json mobile/
RUN pnpm install --frozen-lockfile --filter web...
# Sources (codegen artifacts must be present in the context already).
COPY packages/api-client packages/api-client
COPY web web
RUN pnpm --filter web run build

FROM base AS runner
ENV NODE_ENV=production
RUN useradd --system --uid 1001 --user-group --create-home nextjs
COPY --from=build --chown=nextjs:nextjs /repo /repo
USER nextjs
EXPOSE 3000
# Next must listen on 3000 to match infra/k8s/web.yaml (containerPort/targetPort 3000).
CMD ["pnpm", "--filter", "web", "exec", "next", "start", "-p", "3000"]
