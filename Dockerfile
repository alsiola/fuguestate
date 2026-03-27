FROM node:22-alpine AS ui-build

WORKDIR /ui
COPY ui/package.json ui/package-lock.json* ./
RUN npm install
COPY ui/ ./
RUN npx vite build

FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --production=false

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

RUN npm prune --production

# Copy built UI
COPY --from=ui-build /ui/dist ./ui/dist

EXPOSE 4317

ENV PORT=4317
ENV DB_PATH=/data/amts.sqlite
ENV LOG_LEVEL=info
ENV NODE_ENV=production

CMD ["node", "dist/app/server.js"]
