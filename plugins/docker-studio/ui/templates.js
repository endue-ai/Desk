// Starting files for a project: a Dockerfile (multi-stage where the language builds, a user that is
// not root, a health check when asked), a .dockerignore and a compose.yaml with an optional
// database and cache, for the common platforms. Pure: options in, file texts out.

/**
 * @typedef {"node" | "python" | "go" | "java" | "dotnet" | "rust" | "static"} Platform
 * @typedef {{ platform: Platform, name: string, port: number, entry: string, version: string,
 *   nonRoot: boolean, health: boolean, compose: boolean, db: "" | "postgres" | "mysql", cache: boolean }} Scaffold
 */

/** @type {Record<Platform, { label: string, version: string, entry: string, port: number, hint: string }>} */
export const PLATFORMS = {
  node: {
    label: "Node.js",
    version: "22",
    entry: "server.js",
    port: 3000,
    hint: "The file node starts",
  },
  python: {
    label: "Python",
    version: "3.12",
    entry: "app:app",
    port: 8000,
    hint: "module:app for gunicorn",
  },
  go: {
    label: "Go",
    version: "1.23",
    entry: "./cmd/server",
    port: 8080,
    hint: "The package to build",
  },
  java: {
    label: "Java (Maven)",
    version: "21",
    entry: "app.jar",
    port: 8080,
    hint: "The jar Maven makes",
  },
  dotnet: {
    label: ".NET",
    version: "8.0",
    entry: "App.dll",
    port: 8080,
    hint: "The assembly to run",
  },
  rust: { label: "Rust", version: "1.82", entry: "app", port: 8080, hint: "The binary's name" },
  static: {
    label: "Static site (nginx)",
    version: "1.27",
    entry: "dist",
    port: 80,
    hint: "The folder of built files",
  },
};

/** @param {Platform} platform @returns {Scaffold} */
export function scaffoldFor(platform, name = "app") {
  const p = PLATFORMS[platform];
  return {
    platform,
    name,
    port: p.port,
    entry: p.entry,
    version: p.version,
    nonRoot: true,
    health: true,
    compose: true,
    db: "",
    cache: false,
  };
}

const lines = (/** @type {Array<string | false | null | undefined>} */ list) =>
  `${list.filter((l) => l !== false && l !== null && l !== undefined).join("\n")}\n`;

/** The health check line for a port, with a tool the image has. */
const health = (/** @type {Scaffold} */ s, /** @type {string} */ probe) =>
  s.health ? `HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD ${probe}` : false;

/** @param {Scaffold} s */
function dockerfile(s) {
  const port = String(s.port);
  switch (s.platform) {
    case "node":
      return lines([
        `FROM node:${s.version}-alpine AS deps`,
        "WORKDIR /app",
        "COPY package.json package-lock.json* ./",
        "RUN npm ci --omit=dev",
        "",
        `FROM node:${s.version}-alpine`,
        "ENV NODE_ENV=production",
        "WORKDIR /app",
        "COPY --from=deps /app/node_modules ./node_modules",
        "COPY . .",
        s.nonRoot && "USER node",
        `EXPOSE ${port}`,
        health(s, `wget -qO- http://localhost:${port}/ || exit 1`),
        `CMD ["node", "${s.entry}"]`,
      ]);
    case "python":
      return lines([
        `FROM python:${s.version}-slim`,
        "ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1",
        "WORKDIR /app",
        "COPY requirements.txt .",
        "RUN pip install --no-cache-dir -r requirements.txt gunicorn",
        "COPY . .",
        s.nonRoot && "RUN useradd --create-home app",
        s.nonRoot && "USER app",
        `EXPOSE ${port}`,
        health(
          s,
          `python -c "import urllib.request; urllib.request.urlopen('http://localhost:${port}/')" || exit 1`,
        ),
        `CMD ["gunicorn", "--bind", "0.0.0.0:${port}", "${s.entry}"]`,
      ]);
    case "go":
      return lines([
        `FROM golang:${s.version}-alpine AS build`,
        "WORKDIR /src",
        "COPY go.mod go.sum* ./",
        "RUN go mod download",
        "COPY . .",
        `RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/server ${s.entry}`,
        "",
        "FROM gcr.io/distroless/static-debian12",
        "COPY --from=build /out/server /server",
        s.nonRoot && "USER nonroot:nonroot",
        `EXPOSE ${port}`,
        'ENTRYPOINT ["/server"]',
      ]);
    case "java":
      return lines([
        `FROM maven:3-eclipse-temurin-${s.version} AS build`,
        "WORKDIR /src",
        "COPY pom.xml .",
        "RUN mvn -q dependency:go-offline",
        "COPY src ./src",
        "RUN mvn -q package -DskipTests",
        "",
        `FROM eclipse-temurin:${s.version}-jre`,
        "WORKDIR /app",
        `COPY --from=build /src/target/*.jar ${s.entry}`,
        s.nonRoot && "RUN useradd --system app",
        s.nonRoot && "USER app",
        `EXPOSE ${port}`,
        `ENTRYPOINT ["java", "-jar", "${s.entry}"]`,
      ]);
    case "dotnet":
      return lines([
        `FROM mcr.microsoft.com/dotnet/sdk:${s.version} AS build`,
        "WORKDIR /src",
        "COPY . .",
        "RUN dotnet publish -c Release -o /out",
        "",
        `FROM mcr.microsoft.com/dotnet/aspnet:${s.version}`,
        "WORKDIR /app",
        "COPY --from=build /out .",
        `ENV ASPNETCORE_URLS=http://+:${port}`,
        s.nonRoot && "USER app",
        `EXPOSE ${port}`,
        `ENTRYPOINT ["dotnet", "${s.entry}"]`,
      ]);
    case "rust":
      return lines([
        `FROM rust:${s.version}-slim AS build`,
        "WORKDIR /src",
        "COPY . .",
        "RUN cargo build --release --locked",
        "",
        "FROM debian:bookworm-slim",
        `COPY --from=build /src/target/release/${s.entry} /usr/local/bin/app`,
        s.nonRoot && "RUN useradd --system app",
        s.nonRoot && "USER app",
        `EXPOSE ${port}`,
        'CMD ["app"]',
      ]);
    default:
      return lines([
        `FROM nginx:${s.version}-alpine`,
        `COPY ${s.entry}/ /usr/share/nginx/html/`,
        `EXPOSE ${port}`,
        health(s, `wget -qO- http://localhost:${port}/ || exit 1`),
      ]);
  }
}

const IGNORE = /** @type {Record<Platform, string[]>} */ ({
  node: ["node_modules", "npm-debug.log*", "coverage"],
  python: ["__pycache__", "*.pyc", ".venv", ".pytest_cache"],
  go: ["bin", "*.test"],
  java: ["target", "*.class"],
  dotnet: ["bin", "obj"],
  rust: ["target"],
  static: ["node_modules"],
});

/** @param {Scaffold} s */
function dockerignore(s) {
  return lines([
    ".git",
    ".gitignore",
    ".env",
    ".env.*",
    "Dockerfile*",
    "compose*.yaml",
    ".dockerignore",
    "*.md",
    ...IGNORE[s.platform],
  ]);
}

/** @param {Scaffold} s */
function compose(s) {
  const env = [
    s.db === "postgres" && `      DATABASE_URL: postgres://app:app@db:5432/app`,
    s.db === "mysql" && `      DATABASE_URL: mysql://app:app@db:3306/app`,
    s.cache && "      REDIS_URL: redis://cache:6379",
  ].filter(Boolean);
  const deps = [
    s.db && "      db:\n        condition: service_healthy",
    s.cache && "      cache:\n        condition: service_started",
  ].filter(Boolean);
  return lines([
    "services:",
    `  ${s.name}:`,
    "    build: .",
    "    ports:",
    `      - "${s.port}:${s.port}"`,
    env.length > 0 && "    environment:",
    ...env,
    deps.length > 0 && "    depends_on:",
    ...deps,
    "    restart: unless-stopped",
    s.db === "postgres" &&
      '  db:\n    image: postgres:16-alpine\n    environment:\n      POSTGRES_USER: app\n      POSTGRES_PASSWORD: app\n      POSTGRES_DB: app\n    volumes:\n      - db-data:/var/lib/postgresql/data\n    healthcheck:\n      test: ["CMD-SHELL", "pg_isready -U app"]\n      interval: 5s\n      retries: 10',
    s.db === "mysql" &&
      '  db:\n    image: mysql:8.4\n    environment:\n      MYSQL_USER: app\n      MYSQL_PASSWORD: app\n      MYSQL_DATABASE: app\n      MYSQL_RANDOM_ROOT_PASSWORD: "yes"\n    volumes:\n      - db-data:/var/lib/mysql\n    healthcheck:\n      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]\n      interval: 5s\n      retries: 10',
    s.cache && "  cache:\n    image: redis:7-alpine",
    s.db && "volumes:\n  db-data:",
  ]);
}

/** The files to write, by name. @param {Scaffold} s @returns {Array<[string, string]>} */
export function filesFor(s) {
  /** @type {Array<[string, string]>} */
  const out = [
    ["Dockerfile", dockerfile(s)],
    [".dockerignore", dockerignore(s)],
  ];
  if (s.compose) out.push(["compose.yaml", compose(s)]);
  return out;
}
