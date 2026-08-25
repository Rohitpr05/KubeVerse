FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY shared ./shared
COPY services/validation ./services/validation
RUN npm install --omit=dev --ignore-scripts
ENV NODE_ENV=production PORT=3001
EXPOSE 3001
CMD ["node", "services/validation/src/server.js"]
