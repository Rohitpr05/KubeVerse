FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY shared ./shared
COPY services/ocr ./services/ocr
RUN npm install --omit=dev --ignore-scripts
ENV NODE_ENV=production PORT=3003
EXPOSE 3003
CMD ["node", "services/ocr/src/server.js"]
