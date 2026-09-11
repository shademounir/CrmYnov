// Deliberately bounded lexical/structural recognition, not a PostgreSQL parser.
// Anything outside the new FK / ADD COLUMN grammar remains fail-closed.
function quotedToken(source, start) {
  const quote = source[start]; let value = ""; let at = start + 1;
  while (at < source.length) {
    if (source[at] === quote) {
      if (source[at + 1] === quote) { value += quote; at += 2; continue; }
      return { token: { kind: quote === "'" ? "string" : "identifier", value }, at: at + 1 };
    }
    if (source[at] === "\\") throw new Error("ambiguous_sql_escape");
    value += source[at]; at += 1;
  }
  throw new Error("unterminated_sql_quote");
}

function unquotedToken(source, at) {
  const rest = source.slice(at);
  const word = /^[A-Za-z_][A-Za-z_0-9]*/u.exec(rest);
  const number = /^\d+(?:\.\d+)?/u.exec(rest);
  if (word || number) {
    const value = (word ?? number)[0];
    return { token: { kind: word ? "word" : "number", value }, at: at + value.length };
  }
  const operator = [">=", "<=", "<>", "!=", "(", ")", ",", ">", "<", "=", "+", "-", ".", "[", "]"].find(value => rest.startsWith(value));
  if (!operator) throw new Error("unknown_sql_token");
  return { token: { kind: "symbol", value: operator }, at: at + operator.length };
}

function nextSqlToken(source, at) {
  if (source.startsWith("/*", at) || source.startsWith("*/", at)) throw new Error("ambiguous_sql_comment");
  if (source[at] === "'" || source[at] === '"') return quotedToken(source, at);
  return unquotedToken(source, at);
}

export function sqlStatements(source) {
  const statements = []; let tokens = []; let at = 0;
  while (at < source.length) {
    if (/\s/u.test(source[at])) { at += 1; continue; }
    if (source.startsWith("--", at)) { const end = source.indexOf("\n", at); at = end < 0 ? source.length : end + 1; continue; }
    if (source[at] === ";") { if (tokens.length) statements.push(tokens); tokens = []; at += 1; continue; }
    const next = nextSqlToken(source, at);
    tokens.push(next.token); at = next.at;
  }
  if (tokens.length) statements.push(tokens);
  return statements;
}

const keyword = (token, value) => token?.kind === "word" && token.value.toUpperCase() === value;
const identifier = token => token?.kind === "identifier" || token?.kind === "word";
const symbol = (token, value) => token?.kind === "symbol" && token.value === value;

function reader(tokens) {
  let at = 0;
  return {
    peek: () => tokens[at],
    done: () => at === tokens.length,
    word(value) { if (!keyword(tokens[at], value)) return false; at += 1; return true; },
    symbol(value) { if (!symbol(tokens[at], value)) return false; at += 1; return true; },
    id() { if (!identifier(tokens[at])) return undefined; return tokens[at++].value; },
    take() { return tokens[at++]; },
  };
}

function identifierList(input) {
  if (!input.symbol("(") || input.id() === undefined) return false;
  while (input.symbol(",")) if (input.id() === undefined) return false;
  return input.symbol(")");
}

function foreignKeyActions(tokens) {
  const input = reader(tokens);
  if (input.word("CONSTRAINT") && input.id() === undefined) return false;
  if (!input.word("FOREIGN") || !input.word("KEY") || !identifierList(input) || !input.word("REFERENCES") || input.id() === undefined || !identifierList(input)) return false;
  const seen = new Set();
  while (!input.done()) {
    if (!input.word("ON")) return false;
    const event = input.word("DELETE") ? "DELETE" : input.word("UPDATE") ? "UPDATE" : undefined;
    if (!event || seen.has(event) || !input.word(event === "DELETE" ? "RESTRICT" : "CASCADE")) return false;
    seen.add(event);
  }
  return seen.size > 0;
}

// Only complete table-level FK definitions inside a plain CREATE TABLE may
// contribute these two action keywords. Never strip keywords globally.
function completedTableParts(tokens, at, start, parts) {
  if (at !== tokens.length - 1) return [];
  parts.push(tokens.slice(start, at));
  return parts.some(part => part.length === 0) ? [] : parts;
}

function tableDefinitionParts(tokens) {
  let depth = 1; let start = 4; const parts = [];
  for (let at = 4; at < tokens.length; at += 1) {
    if (symbol(tokens[at], "(")) depth += 1;
    if (symbol(tokens[at], ")")) {
      depth -= 1;
      if (depth === 0) return completedTableParts(tokens, at, start, parts);
    }
    if (depth === 1 && symbol(tokens[at], ",")) { parts.push(tokens.slice(start, at)); start = at + 1; }
  }
  return [];
}

export function recognizedForeignKeyWords(tokens) {
  if (!keyword(tokens[0], "CREATE") || !keyword(tokens[1], "TABLE") || !identifier(tokens[2]) || !symbol(tokens[3], "(")) return new Set();
  const parts = tableDefinitionParts(tokens);
  return new Set(parts.filter(foreignKeyActions).flat().filter(token => keyword(token, "DELETE") || keyword(token, "UPDATE")));
}

function numericLiteral(input) {
  if (symbol(input.peek(), "+") || symbol(input.peek(), "-")) input.take();
  if (input.peek()?.kind !== "number") return false;
  input.take(); return true;
}

function defaultLiteral(input) {
  if (input.peek()?.kind === "string") { input.take(); return true; }
  for (const value of ["TRUE", "FALSE", "CURRENT_TIMESTAMP"]) if (input.word(value)) return true;
  if (input.word("NOW") || input.word("GEN_RANDOM_UUID")) return input.symbol("(") && input.symbol(")");
  return numericLiteral(input);
}

function boundedCheck(input, column) {
  if (!input.symbol("(") || input.id() !== column) return false;
  if (input.word("BETWEEN")) return numericLiteral(input) && input.word("AND") && numericLiteral(input) && input.symbol(")");
  if (!input.peek() || ![">=", "<=", ">", "<", "=", "<>", "!="].some(value => input.symbol(value))) return false;
  return numericLiteral(input) && input.symbol(")");
}

function columnType(input) {
  const type = input.take();
  if (type?.kind !== "word" || !["TEXT", "UUID", "JSON", "JSONB", "BOOLEAN", "INTEGER", "INT", "BIGINT", "SMALLINT", "VARCHAR", "CHAR", "TIMESTAMP", "TIMESTAMPTZ", "DATE", "NUMERIC", "DECIMAL", "REAL", "DOUBLE"].includes(type.value.toUpperCase())) return false;
  if (type.value.toUpperCase() === "DOUBLE" && !input.word("PRECISION")) return false;
  if (input.symbol("(")) {
    const size = input.take();
    if (size?.kind !== "number" || !/^\d+$/u.test(size.value) || !input.symbol(")")) return false;
  }
  return true;
}

function columnConstraint(input, column, seen) {
  if (input.word("NOT")) {
    if (seen.has("NOT") || !input.word("NULL")) return false;
    seen.add("NOT"); return true;
  }
  if (input.word("DEFAULT")) {
    if (seen.has("DEFAULT") || !defaultLiteral(input)) return false;
    seen.add("DEFAULT"); return true;
  }
  if (input.word("CHECK")) {
    if (seen.has("CHECK") || !boundedCheck(input, column)) return false;
    seen.add("CHECK"); return true;
  }
  return false;
}

function columnDefinition(input) {
  const column = input.id(); if (column === undefined || !columnType(input)) return false;
  const seen = new Set();
  while (!input.done() && !symbol(input.peek(), ",")) {
    if (!columnConstraint(input, column, seen)) return false;
  }
  return !seen.has("NOT") || seen.has("DEFAULT");
}

export function structuredAddColumn(tokens) {
  const input = reader(tokens);
  if (!input.word("ALTER") || !input.word("TABLE") || input.id() === undefined) return false;
  do { if (!input.word("ADD") || !input.word("COLUMN") || !columnDefinition(input)) return false; } while (input.symbol(","));
  return input.done();
}

export function statementText(tokens) {
  return tokens.map(token => token.kind === "identifier" ? `"${token.value.replaceAll('"', '""')}"` : token.kind === "string" ? "'literal'" : token.value).join(" ");
}
