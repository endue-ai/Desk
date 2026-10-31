import { describe, expect, it } from "vitest";
import { parseHcl } from "../ui/parse/hcl.js";
import { childrenOf, plainOf } from "../ui/tree.js";
import { at } from "./harness";
import { kid, rootOf, where } from "./nodes";

const MAIN = `# A Terraform file
terraform {
  required_version = ">= 1.5"
}

variable "region" {
  type    = string
  default = "eu-west-1"
}

resource "aws_instance" "web" {
  ami           = "ami-0abc"
  instance_type = var.instance_type
  count         = 2
  enabled       = true
  ratio         = 1.5e2
  tags = {
    Name = "web-\${var.env}"
    "Team" = "desk"
  }
  ports = [80, 443,]
  user_data = <<-EOT
    #!/bin/sh
    echo hello
  EOT
  // a line comment
  /* a block
     comment */
  nothing = null
  zones = [for z in var.zones : upper(z)]
  size = var.big ? "large" : "small"

  lifecycle { create_before_destroy = true }
}
`;

describe("HCL 2 native syntax", () => {
  it("blocks with labels, attributes, lists, objects, heredocs and comments", () => {
    const doc = parseHcl(MAIN);
    expect(doc.errors).toEqual([]);
    const root = rootOf(doc);
    expect(childrenOf(root).map((n) => n.key)).toEqual([
      "terraform",
      'variable "region"',
      'resource "aws_instance" "web"',
    ]);
    expect(plainOf(root)).toEqual({
      terraform: { required_version: ">= 1.5" },
      'variable "region"': { type: "string", default: "eu-west-1" },
      'resource "aws_instance" "web"': {
        ami: "ami-0abc",
        instance_type: "var.instance_type",
        count: 2,
        enabled: true,
        ratio: 150,
        // biome-ignore lint/suspicious/noTemplateCurlyInString: an HCL template, kept as written
        tags: { Name: "web-${var.env}", Team: "desk" },
        ports: [80, 443],
        user_data: "#!/bin/sh\necho hello\n",
        nothing: null,
        zones: "[for z in var.zones : upper(z)]",
        size: 'var.big ? "large" : "small"',
        lifecycle: { create_before_destroy: true },
      },
    });
    const web = kid(root, 'resource "aws_instance" "web"');
    expect(web).toMatchObject({ kind: "object", tag: "block" });
    expect(where(web)).toEqual(at(MAIN, "resource"));
    expect(kid(root, 'variable "region"', "type")).toMatchObject({
      kind: "string",
      tag: "expression",
    });
    expect(kid(web, "instance_type").tag).toBe("expression");
    expect(kid(web, "zones").tag).toBe("expression");
    expect(kid(web, "tags", "Name")).toMatchObject({ kind: "string", tag: "template" });
    expect(kid(web, "ami").tag).toBeUndefined();
    expect(where(kid(web, "count"))).toEqual(at(MAIN, "count"));
    expect(where(kid(web, "ports", 1))).toEqual(at(MAIN, "443"));
  });

  it("reads .tfvars, heredocs without indent stripping, and nested blocks of one type", () => {
    const text = `region = "us-east-1"
zones  = ["a", "b"]
script = <<EOT
  kept
EOT
dynamic "ingress" {
  content { port = 1 }
}
`;
    const doc = parseHcl(text);
    expect(doc.errors).toEqual([]);
    expect(plainOf(rootOf(doc))).toEqual({
      region: "us-east-1",
      zones: ["a", "b"],
      script: "  kept\n",
      'dynamic "ingress"': { content: { port: 1 } },
    });
  });

  it("an error says its line and the tree keeps what parsed before it", () => {
    const text = 'a = 1\nb = "open\nc = 3\n';
    const doc = parseHcl(text);
    expect(doc.errors).toHaveLength(1);
    expect(doc.errors[0]?.line).toBe(2);
    expect(plainOf(rootOf(doc))).toEqual({ a: 1 });
    expect(parseHcl("block {\n  x = 1\n").errors[0]?.line).toBe(3);
  });
});
