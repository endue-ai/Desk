// Makes the plugin's fixtures. With no argument it rebuilds fixtures/sample.bplist from
// fixtures/sample.plist with `plutil -convert binary1` (macOS). With a folder it also writes one
// realistic file per format there, with made-up values only, for the live check and screenshots:
//
//   node plugins/data/tests/make-fixtures.mjs /tmp/data-samples
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const here = import.meta.dirname;
const plist = join(here, "fixtures/sample.plist");
const bplist = join(here, "fixtures/sample.bplist");

/** MessagePack for the values the samples use. */
function msgpack(value) {
  const out = [];
  const enc = new TextEncoder();
  const put = (v) => {
    if (v === null) out.push(0xc0);
    else if (typeof v === "boolean") out.push(v ? 0xc3 : 0xc2);
    else if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 128) out.push(v);
    else if (typeof v === "number" && Number.isInteger(v)) {
      out.push(0xd2, (v >> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff);
    } else if (typeof v === "number") {
      const view = new DataView(new ArrayBuffer(8));
      view.setFloat64(0, v);
      out.push(0xcb, ...new Uint8Array(view.buffer));
    } else if (typeof v === "string") {
      const bytes = enc.encode(v);
      out.push(
        bytes.length < 32 ? 0xa0 | bytes.length : 0xd9,
        ...(bytes.length < 32 ? [] : [bytes.length]),
        ...bytes,
      );
    } else if (v instanceof Uint8Array) out.push(0xc4, v.length, ...v);
    else if (Array.isArray(v)) {
      out.push(0x90 | v.length);
      v.forEach(put);
    } else {
      const entries = Object.entries(v);
      out.push(0x80 | entries.length);
      for (const [k, item] of entries) {
        put(k);
        put(item);
      }
    }
  };
  put(value);
  return new Uint8Array(out);
}

/** CBOR for the values the samples use; a Date becomes tag 1. */
function cbor(value) {
  const out = [];
  const head = (major, n) => {
    if (n < 24) out.push((major << 5) | n);
    else if (n < 256) out.push((major << 5) | 24, n);
    else
      out.push((major << 5) | 26, (n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff);
  };
  const put = (v) => {
    if (v === null) out.push(0xf6);
    else if (typeof v === "boolean") out.push(v ? 0xf5 : 0xf4);
    else if (v instanceof Date) {
      out.push(0xc1);
      put(Math.floor(v.getTime() / 1000));
    } else if (typeof v === "number" && Number.isInteger(v))
      head(v < 0 ? 1 : 0, v < 0 ? -1 - v : v);
    else if (typeof v === "number") {
      const view = new DataView(new ArrayBuffer(8));
      view.setFloat64(0, v);
      out.push(0xfb, ...new Uint8Array(view.buffer));
    } else if (typeof v === "string") {
      const bytes = new TextEncoder().encode(v);
      head(3, bytes.length);
      out.push(...bytes);
    } else if (v instanceof Uint8Array) {
      head(2, v.length);
      out.push(...v);
    } else if (Array.isArray(v)) {
      head(4, v.length);
      v.forEach(put);
    } else {
      const entries = Object.entries(v);
      head(5, entries.length);
      for (const [k, item] of entries) {
        put(k);
        put(item);
      }
    }
  };
  put(value);
  return new Uint8Array(out);
}

/** BSON documents for the values the samples use; a Date is a UTC datetime. */
function bson(value) {
  const enc = new TextEncoder();
  const int32 = (n) => {
    const view = new DataView(new ArrayBuffer(4));
    view.setInt32(0, n, true);
    return [...new Uint8Array(view.buffer)];
  };
  const doc = (object) => {
    const body = [];
    for (const [name, v] of Object.entries(object)) {
      const key = [...enc.encode(name), 0];
      if (typeof v === "string") {
        const bytes = [...enc.encode(v), 0];
        body.push(0x02, ...key, ...int32(bytes.length), ...bytes);
      } else if (typeof v === "boolean") body.push(0x08, ...key, v ? 1 : 0);
      else if (v === null) body.push(0x0a, ...key);
      else if (typeof v === "number" && Number.isInteger(v)) body.push(0x10, ...key, ...int32(v));
      else if (typeof v === "number") {
        const view = new DataView(new ArrayBuffer(8));
        view.setFloat64(0, v, true);
        body.push(0x01, ...key, ...new Uint8Array(view.buffer));
      } else if (v instanceof Date) {
        const view = new DataView(new ArrayBuffer(8));
        view.setBigInt64(0, BigInt(v.getTime()), true);
        body.push(0x09, ...key, ...new Uint8Array(view.buffer));
      } else if (Array.isArray(v))
        body.push(0x04, ...key, ...doc(Object.fromEntries(v.map((x, i) => [String(i), x]))));
      else body.push(0x03, ...key, ...doc(v));
    }
    return [...int32(body.length + 5), ...body, 0];
  };
  return new Uint8Array(doc(value));
}

const record = {
  id: 42,
  name: "Desk sample",
  ratio: 1.5,
  enabled: true,
  owner: null,
  tags: ["data", "sample"],
  db: { host: "db.example.invalid", user: "example", password: "hunter2" },
};

/** One realistic file per format, made-up values only. */
const SAMPLES = {
  "package.json": `${JSON.stringify(
    {
      $schema: "./package.schema.json",
      name: "@example/desk-sample",
      version: "1.4.0",
      private: true,
      type: "module",
      scripts: { build: "vite build", test: "vitest run", lint: "biome check ." },
      dependencies: { react: "^19.1.0", zod: "^4.0.0" },
      devDependencies: { vite: "^8.0.0", vitest: "^5.0.0" },
      engines: { node: ">=22" },
      big: "BIG",
    },
    null,
    2,
  ).replace('"big": "BIG"', '"big": 9007199254740993')}\n`,
  "package.schema.json": `${JSON.stringify(
    {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      required: ["name", "version", "license"],
      properties: {
        name: { type: "string", pattern: "^(@[a-z0-9-]+/)?[a-z0-9-]+$" },
        version: { type: "string", pattern: "^\\d+\\.\\d+\\.\\d+" },
        private: { type: "boolean" },
        engines: { type: "object", additionalProperties: { type: "string" } },
      },
    },
    null,
    2,
  )}\n`,
  "tsconfig.json": `{
  // Shared settings for the sample project.
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "strict": true, /* every strict check */
    "paths": { "@/*": ["./src/*"], },
  },
  "include": ["src", "tests"],
}
`,
  "settings.jsonc":
    '{\n  // Editor settings\n  "editor.fontSize": 13,\n  "files.exclude": { "**/.git": true, },\n}\n',
  "config.json5":
    "// JSON5 sample\n{\n  name: 'desk',\n  port: 0x1F90,\n  ratio: .5,\n  retries: +3,\n  timeout: Infinity,\n  hosts: ['a.example.invalid', 'b.example.invalid',],\n}\n",
  "events.jsonl":
    '{"at": "2026-11-01T09:00:00Z", "event": "open", "file": "a.json"}\n{"at": "2026-11-01T09:00:02Z", "event": "search", "query": "port"}\n{"at": "2026-11-01T09:00:05Z", "event": "close",\n{"at": "2026-11-01T09:00:07Z", "event": "open", "file": "b.yaml"}\n',
  "events.ndjson": '{"n": 1, "ok": true}\n{"n": 2, "ok": false}\n',
  "broken.json": '{\n  "name": "broken",\n  "items": [1, 2,, 3],\n  "after": true\n}\n',
  "docker-compose.yml": `# yaml-language-server: $schema=compose.schema.json
x-defaults: &defaults
  restart: unless-stopped
  logging:
    driver: json-file

services:
  web:
    <<: *defaults
    image: example/web:1.4
    ports:
      - "8080:80"
    environment:
      DATABASE_URL: postgres://example@db:5432/app
      DB_PASSWORD: hunter2
    depends_on: [db]
  db:
    <<: *defaults
    image: postgres:17
    volumes:
      - db-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD", "pg_isready"]
      interval: 10s

volumes:
  db-data: {}
`,
  "compose.schema.json": `${JSON.stringify(
    {
      type: "object",
      required: ["services"],
      properties: {
        services: {
          type: "object",
          additionalProperties: {
            type: "object",
            required: ["image"],
            properties: { ports: { type: "array", items: { type: "integer" } } },
          },
        },
      },
    },
    null,
    2,
  )}\n`,
  "deploy.yaml":
    "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: sample\ndata:\n  mode: |\n    fast\n    safe\n---\napiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: sample\nspec:\n  replicas: 3\n",
  "Cargo.toml": `[package]
name = "desk-sample"
version = "0.3.0"
edition = "2024"
description = """
A sample crate for the data viewer."""

[dependencies]
serde = { version = "1", features = ["derive"] }
tokio = { version = "1.47", features = ["rt", "macros"], optional = true }

[features]
default = []
async = ["dep:tokio"]

[[bin]]
name = "sample"
path = "src/main.rs"

[profile.release]
lto = true
opt-level = 3
released = 2026-10-31T09:00:00Z
`,
  "pom.xml": `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <modelVersion>4.0.0</modelVersion>
  <groupId>invalid.example</groupId>
  <artifactId>desk-sample</artifactId>
  <version>1.0.0</version>
  <!-- dependencies -->
  <dependencies>
    <dependency><groupId>org.example</groupId><artifactId>lib</artifactId><version>2.1</version></dependency>
  </dependencies>
  <description><![CDATA[A <sample> & more]]></description>
</project>
`,
  "schema.xsd": `<?xml version="1.0"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="note">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="to" type="xs:string"/>
        <xs:element name="body" type="xs:string"/>
      </xs:sequence>
    </xs:complexType>
  </xs:element>
</xs:schema>
`,
  "style.xslt": `<?xml version="1.0"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:template match="/">
    <html><body><xsl:value-of select="note/body"/></body></html>
  </xsl:template>
</xsl:stylesheet>
`,
  "php.ini":
    '; PHP sample\n[PHP]\nmemory_limit = 256M\ndisplay_errors = Off\n\n[Date]\ndate.timezone = "UTC"\n\n[mysql]\nmysql.default_password = hunter2\n',
  "setup.cfg":
    "[metadata]\nname = desk-sample\nversion = 0.1\n\n[options]\npackages = find:\ninstall_requires =\n    requests\n    pyyaml\n",
  "nginx.conf":
    "server {\n  listen 80;\n  server_name example.invalid;\n  location / {\n    root /var/www;\n  }\n}\n",
  "app.properties":
    "# Sample\napp.name=Desk\napp.greeting=Hello\\tWorld\ndb.password=hunter2\nlong.value=first \\\n    second\nunicode=caf\\u00e9\n",
  ".env":
    "# Local settings\nDATABASE_URL=postgres://example@localhost/app\nexport DB_PASSWORD=hunter2\nAPI_KEY='xxxx'\nGREETING=\"hello\\nworld\"\n",
  ".env.local": "DEBUG=true\nPORT=3000\n",
  "main.tf": `terraform {
  required_version = ">= 1.6"
}

variable "region" {
  type    = string
  default = "eu-west-1"
}

resource "aws_instance" "web" {
  ami           = "ami-0example"
  instance_type = var.instance_type
  count         = 2
  tags = {
    Name = "web-\${var.env}"
  }
  user_data = <<-EOT
    #!/bin/sh
    echo hello
  EOT
}

output "ip" {
  value = aws_instance.web[0].public_ip
}
`,
  "prod.tfvars": 'region = "us-east-1"\ninstance_type = "t3.small"\nzones = ["a", "b"]\n',
  "config.hcl": 'service "web" {\n  port = 8080\n  # health\n  check { path = "/health" }\n}\n',
};

const BINARY = {
  "dump.msgpack": () => msgpack(record),
  "dump.cbor": () => cbor({ ...record, when: new Date("2026-10-31T09:00:00Z") }),
  "dump.bson": () => bson({ ...record, when: new Date("2026-10-31T09:00:00Z") }),
};

const binaryPlist = () => {
  execFileSync("plutil", ["-convert", "binary1", "-o", bplist, plist]);
  return readFileSync(bplist);
};

const out = process.argv[2];
binaryPlist();
if (out) {
  mkdirSync(out, { recursive: true });
  for (const [name, text] of Object.entries(SAMPLES)) writeFileSync(join(out, name), text);
  for (const [name, make] of Object.entries(BINARY)) writeFileSync(join(out, name), make());
  copyFileSync(plist, join(out, "Info.plist"));
  copyFileSync(bplist, join(out, "Info-binary.plist"));
  console.info(
    `wrote ${Object.keys(SAMPLES).length + Object.keys(BINARY).length + 2} files to ${out}`,
  );
}
