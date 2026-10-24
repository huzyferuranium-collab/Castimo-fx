# Builds the website and runs the trade server (broker verification) in one container.
FROM node:22
WORKDIR /app
COPY package.json ./
COPY package-lock.json* ./
RUN npm install --no-audit --no-fund --legacy-peer-deps
COPY . .
RUN npm run build
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npx", "tsx", "server.ts"]
