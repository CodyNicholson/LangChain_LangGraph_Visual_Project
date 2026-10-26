# Production image: the Angular CLI builds a minified bundle, nginx serves it on port 80
# and proxies /api (REST + Server-Sent Events) to the FastAPI backend.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npx ng build

# Test stage: `docker build --target test ./frontend` runs the Vitest unit tests
FROM build AS test
RUN CI=1 npx ng test --watch=false

# Unprivileged nginx runs as uid 101, not root. It can still listen on 80 because Docker lets
# containers bind low ports (net.ipv4.ip_unprivileged_port_start=0).
FROM nginxinc/nginx-unprivileged:1.31-alpine
COPY --from=build /app/dist/langlab-ui/browser /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY security-headers.conf /etc/nginx/snippets/security-headers.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
