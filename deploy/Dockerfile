FROM node:18-alpine

WORKDIR /app

# Copy package files first for better Docker layer caching
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy the entire source code
COPY . .

# Expose the port
EXPOSE 8080

# Start the server
CMD ["node", "server.js"]
