# The browser service: the only place a supplier's website is ever opened. It holds no database
# credentials and no encryption key. Build from the repository root:
#   docker build -f services/browser/Dockerfile -t stock-monitor-browser .
#
# The image tag must match the "playwright" version in services/browser/package.json. Change both together.
FROM mcr.microsoft.com/playwright:v1.65.0-noble
WORKDIR /app
ENV NODE_ENV=production

# The virtual screen (Xvfb) and the VNC server that shares it, for the live login window.
RUN apt-get update && apt-get install -y --no-install-recommends xvfb x11vnc && rm -rf /var/lib/apt/lists/*

# Only what the service needs: its own package, the supplier-session package and crypto (which that imports).
COPY package.json package-lock.json ./
COPY services/browser/package.json services/browser/
COPY packages/supplier-session/package.json packages/supplier-session/
COPY packages/crypto/package.json packages/crypto/
RUN npm ci --omit=dev --workspace services/browser && npm cache clean --force
COPY services/browser/src services/browser/src
COPY packages/supplier-session/src packages/supplier-session/src
COPY packages/crypto/src packages/crypto/src
COPY --chmod=755 services/browser/entrypoint.sh services/browser/entrypoint.sh

# The image's own non-root user. Chromium's sandbox stays on, which needs user namespaces, and Docker's default seccomp
# profile blocks them. Run the container with Playwright's own profile, kept unchanged beside this file (from the
# v1.65.0 tag, utils/docker/seccomp_profile.json):
#   docker run --init --ipc=host --security-opt seccomp=services/browser/seccomp_profile.json ...
USER pwuser
ENV PORT=8080 HOST=0.0.0.0
# Two ports are used inside the container: 8080 for the control API and 5900 for VNC. Neither is EXPOSEd or published,
# so `docker run -P` cannot publish them. Only the API and worker reach them, over a private network.
HEALTHCHECK --interval=15s --timeout=3s --start-period=15s CMD node -e "Promise.all([fetch('http://127.0.0.1:8080/health').then(r=>{if(!r.ok)throw 1}),new Promise((ok,no)=>require('net').connect(5900,'127.0.0.1').once('connect',ok).once('error',no))]).then(()=>process.exit(0),()=>process.exit(1))"
ENTRYPOINT ["services/browser/entrypoint.sh"]
