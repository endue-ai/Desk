/** Whether text outside quotes has no `;` and balanced parentheses. */
export function oneExpression(/** @type {string} */ text) {
  let depth = 0;
  let quote = "";
  for (let i = 0; i < text.length; i++) {
    const c = /** @type {string} */ (text[i]);
    if (quote) {
      if (c === quote) quote = "";
      continue;
    }
    if (c === "'" || c === '"' || c === "`") quote = c;
    else if (c === "(") depth++;
    else if (c === ")" && --depth < 0) return false;
    else if (c === ";" || (c === "-" && text[i + 1] === "-") || (c === "/" && text[i + 1] === "*"))
      return false;
  }
  return depth === 0 && quote === "";
}
