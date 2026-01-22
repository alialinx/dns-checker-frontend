# DNS Checker - Static Frontend
# Serves index.html + app.js
# Port: 8080

FROM python:3.12-alpine

WORKDIR /site

COPY index.html /site/index.html
COPY app.js /site/app.js

EXPOSE 8080

CMD ["python","-m","http.server","8080","--bind","0.0.0.0"]
