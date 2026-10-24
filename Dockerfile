# Builds the website and runs the trade server (broker verification) in one container.
FROM node:22
WORKDIR /app
COPY package.json ./
COPY package-lock.json* ./
RUN npm install --no-audit --no-fund --legacy-peer-deps
COPY . .
# Your real USDT (TRC20) wallet, baked into the website at build time.
ARG VITE_TREASURY_ADDRESS
ENV VITE_TREASURY_ADDRESS=$VITE_TREASURY_ADDRESS
RUN npm run build
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npx", "tsx", "server.ts"]
