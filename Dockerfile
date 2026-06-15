FROM node:18-alpine

WORKDIR /app

# 安装依赖
COPY server/package.json server/package-lock.json ./
RUN npm ci --production

# 拷贝服务端
COPY server/server.js ./
COPY server/.env ./

# 拷贝前端静态文件
COPY index.html style.css script.js ./
COPY 5254.jpg_wh860.jpg ./

EXPOSE 3000

ENV PORT=3000

CMD ["node", "server.js"]
