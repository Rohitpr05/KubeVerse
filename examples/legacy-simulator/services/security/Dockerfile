FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY shared ./shared
COPY services/security ./services/security
RUN npm install --omit=dev --ignore-scripts
ENV NODE_ENV=production PORT=3002
EXPOSE 3002
CMD ["node", "services/security/src/server.js"]
