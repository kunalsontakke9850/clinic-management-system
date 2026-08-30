FROM node:20-bookworm-slim

WORKDIR /app
ENV CI=true

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY --chown=node:node . .
USER node

RUN npm test

CMD ["npm", "test"]
