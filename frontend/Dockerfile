FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

COPY . .

EXPOSE 3000
CMD ["yarn", "start"]
