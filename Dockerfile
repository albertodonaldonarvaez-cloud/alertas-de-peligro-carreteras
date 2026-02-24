FROM node:20-alpine

WORKDIR /app

# Instalar dependencias primero (cache de Docker)
COPY package.json package-lock.json* ./
RUN npm ci --only=production

# Copiar código fuente
COPY server.js ./
COPY public/ ./public/

# Crear directorio de uploads
RUN mkdir -p /app/uploads

EXPOSE 3000

CMD ["node", "server.js"]
