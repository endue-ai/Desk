const number = (label, value, min, max) => ({ label, value, min, max });
const choices = (label, options) => ({ label, options });

function fields(op, { width, height }) {
  switch (op) {
    case "crop":
      return {
        x: number("Left (px)", 0, 0, width - 1),
        y: number("Top (px)", 0, 0, height - 1),
        width: number("Width (px)", width, 1, width),
        height: number("Height (px)", height, 1, height),
      };
    case "resize":
      return {
        width: number("Width (px)", width, 1, 16384),
        height: number("Height (px)", height, 1, 16384),
      };
    case "rotate":
      return {
        degrees: choices("Angle clockwise", [
          [90, "90°"],
          [180, "180°"],
          [270, "270°"],
        ]),
      };
    case "flip":
      return {
        axis: choices("Direction", [
          ["horizontal", "Horizontal"],
          ["vertical", "Vertical"],
        ]),
      };
    case "adjust":
      return {
        brightness: number("Brightness", 0, -100, 100),
        contrast: number("Contrast", 0, -100, 100),
        saturation: number("Saturation", 0, -100, 100),
      };
    case "blur":
      return { radius: number("Radius (px)", 2, 1, 32) };
    case "sharpen":
      return { amount: number("Amount (%)", 50, 1, 100) };
    default:
      return {};
  }
}

export function createControls(operation, values) {
  const entries = new Map();
  return {
    render(info) {
      entries.clear();
      values.replaceChildren();
      if (!info.document) return;
      for (const [key, config] of Object.entries(fields(operation.value, info))) {
        const label = document.createElement("label");
        label.textContent = config.label;
        let input;
        if (config.options) {
          input = document.createElement("select");
          input.className = "desk-field";
          for (const [value, text] of config.options) input.add(new Option(text, value));
        } else {
          input = document.createElement("input");
          input.className = "desk-field";
          input.type = "number";
          input.required = true;
          input.min = config.min;
          input.max = config.max;
          input.value = config.value;
        }
        entries.set(key, {
          input,
          numeric: !config.options || typeof config.options[0][0] === "number",
        });
        label.append(input);
        values.append(label);
      }
    },
    read() {
      const edit = { op: operation.value };
      for (const [key, { input, numeric }] of entries) {
        edit[key] = numeric ? Number(input.value) : input.value;
      }
      return edit;
    },
  };
}
