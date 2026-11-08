# ursGAL web — Vite build → nginx (Railway "web" сервис).
# Context: repo-гийн ROOT (railway.json-ийн dockerfilePath = frontend/Dockerfile).
#
# /api/* хүсэлтийг API_UPSTREAM (api сервис) руу same-origin-оор proxy
# хийнэ — refresh token нь SameSite=Strict, path=/api/auth httpOnly cookie
# тул web, api ижил origin дээр байх ёстой (тусдаа домэйнд cookie явахгүй).

FROM node:20-slim AS build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend ./
# Нэвтрэх хуудсанд харагдах демо мэдээлэл (заавал биш)
ARG VITE_DEMO_LOGIN=""
ENV VITE_DEMO_LOGIN=$VITE_DEMO_LOGIN
RUN npm run build

FROM nginx:1.27-alpine
# /etc/nginx/templates/*.template-ийг nginx image эхлэхдээ envsubst хийнэ
COPY frontend/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/frontend/dist /usr/share/nginx/html
ENV PORT=8080 \
    API_UPSTREAM=http://localhost:3000 \
    NGINX_ENVSUBST_FILTER="^(PORT|API_UPSTREAM|API_HOST)$"
EXPOSE 8080
