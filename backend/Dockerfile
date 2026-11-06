FROM node:22-alpine
RUN apk add --no-cache poppler-utils
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev && npm install tsx
COPY src ./src
ENV NODE_ENV=production
CMD ["./node_modules/.bin/tsx","src/server.ts"]
