FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src
ENV PORT=3000
EXPOSE 3000
CMD ["node", "src/server.js"]
