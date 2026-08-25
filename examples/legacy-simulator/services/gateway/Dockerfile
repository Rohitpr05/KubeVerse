# Each service image is built from the repository root so it can consume the shared package.
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY shared ./shared
COPY services/gateway ./services/gateway
RUN npm install --omit=dev --ignore-scripts
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["node", "services/gateway/src/server.js"]
