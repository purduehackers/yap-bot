FROM oven/bun:1.3-alpine
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile

COPY . .

VOLUME /var/lib/bot
ENV DB_FILENAME=/var/lib/bot/messages.db
ENTRYPOINT ["bun", "run", "-b", "src/index.ts"]
