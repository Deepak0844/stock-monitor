FROM node:22-slim
WORKDIR /app
RUN npm init -y >/dev/null && npm install ws@8 @novnc/novnc --no-audit --no-fund
COPY server.mjs ./
COPY public ./public
USER node
CMD ["node", "server.mjs"]
