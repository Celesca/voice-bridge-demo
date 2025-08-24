FROM node:20-alpine AS base
WORKDIR /app

# Install dependencies first for better layer caching
COPY package*.json ./
RUN npm ci --omit=dev

# Copy the rest of the app
COPY . .

EXPOSE 8787
CMD ["node", "server/index.js"]
