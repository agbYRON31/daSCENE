FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN mkdir -p uploads logs
RUN chown -R node:node /app

USER node

EXPOSE 3001

CMD ["npm", "run", "start"]