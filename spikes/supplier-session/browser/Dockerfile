# The official Playwright image, pinned to the exact Playwright version the repo uses.
FROM mcr.microsoft.com/playwright:v1.65.0-noble
RUN apt-get update \
 && apt-get install -y --no-install-recommends xvfb x11vnc \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN npm init -y >/dev/null && npm install playwright@1.65.0 --no-audit --no-fund
COPY control.mjs entrypoint.sh ./
RUN chmod +x entrypoint.sh && chown -R pwuser:pwuser /app
USER pwuser
ENTRYPOINT ["./entrypoint.sh"]
