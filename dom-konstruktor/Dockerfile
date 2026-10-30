# Сайт «Логика Дома»: Node без зависимостей. Данные — в томе /data (заявки, проекты, CRM, контент, медиатека).
FROM node:20-alpine
WORKDIR /app
COPY . .
RUN rm -rf data/runtime dist && addgroup -S -g 10001 app && adduser -S -u 10001 app -G app && mkdir -p /data && chown app:app /data
USER app
ENV PORT=8080 DATA_DIR=/data TRUST_PROXY=1 NODE_ENV=production
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/robots.txt >/dev/null || exit 1
CMD ["node", "server.js"]
