# libc2pa_rust.so is linux/amd64 only. Build with:
#   docker build --platform linux/amd64 -t c2pa-msl-demo .
# Debian Trixie (glibc 2.41). libc2pa_rust.so needs GLIBC_2.38; Bookworm is 2.36.
FROM node:lts-trixie-slim

WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates libgcc-s1 \
 && rm -rf /var/lib/apt/lists/* \
 && if [ "$(uname -m)" != "x86_64" ]; then \
      echo "This image must be linux/amd64 (libc2pa_rust.so)"; \
      exit 1; \
    fi

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY c2pa_sign.js server.js sign_media_all_ai.js ./
COPY rust_binary/libc2pa_rust.so ./rust_binary/libc2pa_rust.so

RUN chown -R node:node /app
USER node

ENV NODE_ENV=production
ENV PORT=8080
ENV C2PA_LIB_PATH=/app/rust_binary/libc2pa_rust.so

EXPOSE 8080
CMD ["node", "server.js"]
