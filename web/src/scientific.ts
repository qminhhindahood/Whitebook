// Recursive-descent arithmetic parser. Learner input is never executed as code.
export function calculate(
  expression: string,
  angle: "degrees" | "radians" = "degrees",
): string {
  if (expression.length > 1000) return "Check expression";
  const input = expression.replace(/\s/g, "").toLowerCase();
  const tokens = input.match(
    /(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|[a-z]+|[()+\-*/^]/g,
  );
  if (!tokens || tokens.join("") !== input) return "Check expression";
  let index = 0;
  const functions: Record<string, (value: number) => number> = {
    sqrt: Math.sqrt,
    abs: Math.abs,
    log: Math.log10,
    ln: Math.log,
    sin: (x) => Math.sin(angle === "degrees" ? (x * Math.PI) / 180 : x),
    cos: (x) => Math.cos(angle === "degrees" ? (x * Math.PI) / 180 : x),
    tan: (x) => Math.tan(angle === "degrees" ? (x * Math.PI) / 180 : x),
  };
  const atom = (): number => {
    const token = tokens[index++];
    if (token === "(") {
      const value = sum();
      if (tokens[index++] !== ")") throw new Error("parenthesis");
      return value;
    }
    if (token === "pi") return Math.PI;
    if (token === "e") return Math.E;
    if (Object.hasOwn(functions, token)) {
      if (tokens[index++] !== "(") throw new Error("function");
      const value = sum();
      if (tokens[index++] !== ")") throw new Error("parenthesis");
      return functions[token](value);
    }
    const value = Number(token);
    if (!Number.isFinite(value)) throw new Error("number");
    return value;
  };
  const power = (): number => {
    const value = atom();
    if (tokens[index] === "^") {
      index++;
      return value ** unary();
    }
    return value;
  };
  const unary = (): number => {
    if (tokens[index] === "-") {
      index++;
      return -unary();
    }
    if (tokens[index] === "+") {
      index++;
      return unary();
    }
    return power();
  };
  const product = (): number => {
    let value = unary();
    while (tokens[index] === "*" || tokens[index] === "/") {
      const operation = tokens[index++];
      const right = unary();
      value = operation === "*" ? value * right : value / right;
    }
    return value;
  };
  const sum = (): number => {
    let value = product();
    while (tokens[index] === "+" || tokens[index] === "-") {
      const operation = tokens[index++];
      const right = product();
      value = operation === "+" ? value + right : value - right;
    }
    return value;
  };
  try {
    const value = sum();
    return index === tokens.length && Number.isFinite(value)
      ? String(Number(value.toPrecision(12)))
      : "Check expression";
  } catch {
    return "Check expression";
  }
}
