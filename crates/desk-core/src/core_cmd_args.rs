use desk_bridge::ErrorCode;
use serde_json::Value;

use crate::handler::error;
use crate::manifest::schema_registry;

/// Validate cmd.invoke's args against the command's argsSchema (absent args are `{}`).
pub(crate) fn check_args(
    schema: &serde_json::Map<String, Value>,
    args: Option<&serde_json::Map<String, Value>>,
) -> Result<(), desk_bridge::BridgeError> {
    let validator = jsonschema::options()
        .with_registry(schema_registry())
        .should_validate_formats(false)
        .build(&Value::Object(schema.clone()))
        .map_err(|e| error(ErrorCode::InvalidParams, format!("argsSchema: {e}")))?;
    let args = Value::Object(args.cloned().unwrap_or_default());
    let problems: Vec<String> = validator
        .iter_errors(&args)
        .map(|e| format!("args{}: {e}", e.instance_path()))
        .collect();
    if problems.is_empty() {
        Ok(())
    } else {
        Err(error(ErrorCode::InvalidParams, problems.join("; ")))
    }
}
