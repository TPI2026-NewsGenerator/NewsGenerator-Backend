# The API of NewsGenerator and its background work (the ingestion), as it runs on the machine that
# stays on (see deploy/compose.yml). Every dependency is installed: express-validator, used by the
# routes, is listed among the devDependencies
FROM node:24-slim
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
# the client of Prisma is generated from the schema, no database is read
RUN DATABASE_URL=postgresql://build@localhost/build pnpm exec prisma generate
ENV TZ=Europe/Zurich
EXPOSE 3001
CMD ["node", "server.js"]
