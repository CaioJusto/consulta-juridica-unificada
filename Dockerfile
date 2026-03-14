FROM node:20-slim AS frontend-build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM python:3.11-slim
WORKDIR /app

# Install Node.js
RUN apt-get update && apt-get install -y curl && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Install Playwright deps
RUN apt-get update && apt-get install -y \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libasound2 libpango-1.0-0 libcairo2 libatspi2.0-0 \
    xvfb xauth \
    && rm -rf /var/lib/apt/lists/*

# Python deps
COPY requirements-python.txt .
RUN pip install --no-cache-dir -r requirements-python.txt
RUN playwright install chromium --with-deps

# Copy built app
COPY --from=frontend-build /app/node_modules ./node_modules
COPY --from=frontend-build /app/dist ./dist
COPY . .

# Entrypoint
COPY entrypoint.sh .
RUN chmod +x entrypoint.sh

EXPOSE 5000
CMD ["./entrypoint.sh"]
