FROM node:20-bookworm

WORKDIR /workspace

COPY . .

RUN npm install -g firebase-tools && \
    npm --prefix functions install

EXPOSE 5001

CMD ["firebase", "emulators:start", "--only", "functions", "--project", "demo-cookie-giorama", "--config", "firebase.json"]
