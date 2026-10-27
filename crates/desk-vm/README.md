# desk-vm

Lightweight Linux VM for MCP tools: boot, vsock, and virtiofs for allowed folders only (Virtualization.framework, WSL2, KVM).

Layer: Rust core (see `docs/architecture.md`). Status: empty shell, no behaviour yet.

## Public API

- `NAME`: the crate name. Nothing else yet.

## Testing

```bash
cargo test -p desk-vm
```
