FROM node:18-alpine
WORKDIR /app

# Install ffmpeg for audio conversion
RUN apk add --no-cache ffmpeg

COPY package*.json ./
RUN npm install
COPY . .
CMD ["node", "src/index.js"]
