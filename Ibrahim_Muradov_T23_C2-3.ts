// MIDTERM C2-3 · Debug the parser                                              (about 20 min)
//
// A colleague "improved" the Lab 2 parser. The GRAMMAR comment is still correct: it is the specification.
// The code no longer follows it. There are exactly 5 bugs:
//   1 in the lexer,  3 in the parser,  1 in the type checker (TypeScript already shows it in red).
//
//   Task 1  Lexer: string literals.     "a" + "b"  must give three tokens:  str:"a" +:+ str:"b" eof
//   Task 2  Parser: precedence and associativity.
//              1 + 2 * 3  is  (1 + (2 * 3))        8 - 3 - 2  is  ((8 - 3) - 2)
//   Task 3  Parser: parentheses and error messages.
//              (1 + 2) * 3  is  ((1 + 2) * 3)      (1 + 2   gives the error   expected ) at 6
//   Plus    the type checker bug (no red underline may remain).
//
// Fix the code, not the grammar. Next to each fix, write a one-line comment:  // FIX: <what was wrong>
// Rules: no  any , no  as , no  ! , no  @ts-ignore . The tests below the editor are read-only.
// Grading also uses hidden tests of the same kind: do not hard-code answers for the visible inputs.
//
// GRAMMAR (EBNF)
//   expr    = "if" expr "then" expr "else" expr | compare ;
//   compare = sum [ ">" sum ] ;
//   sum     = term { ("+" | "-") term } ;
//   term    = primary { "*" primary } ;
//   primary = INT | STRING | IDENT | "(" expr ")" ;

// ---------- AST ----------
type Expr =
  | { kind: "int"; value: number }
  | { kind: "str"; value: string }
  | { kind: "var"; name: string }
  | { kind: "add"; left: Expr; right: Expr }
  | { kind: "sub"; left: Expr; right: Expr }
  | { kind: "mul"; left: Expr; right: Expr }
  | { kind: "gt"; left: Expr; right: Expr }
  | { kind: "if"; cond: Expr; then: Expr; else: Expr };

// ---------- Lexer ----------
type Token = { kind: string; text: string; pos: number };

const RULES: [string, RegExp][] = [
  ["ws",    /\s+/y],
  ["int",   /[0-9]+/y],
  ["ident", /[A-Za-z_]\w*/y],
  ["str",   /"[^"]*"/y], // FIX: Greedy regex matched multiple string literals.
  ["+",     /\+/y],
  ["-",     /-/y],
  ["*",     /\*/y],
  [">",     />/y],
  ["(",     /\(/y],
  [")",     /\)/y],
];
const KW = new Set(["if", "then", "else"]);

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let pos = 0;
  while (pos < src.length) {
    const t = matchAt(src, pos);
    if (t.kind !== "ws") out.push(t);
    pos += t.text.length;
  }
  out.push({ kind: "eof", text: "", pos });
  return out;
}

function matchAt(src: string, pos: number): Token {
  for (const [kind, re] of RULES) {
    re.lastIndex = pos; // sticky: match exactly at pos
    const m = re.exec(src);
    if (m === null) continue;
    const k = kind === "ident" && KW.has(m[0]) ? m[0] : kind;
    return { kind: k, text: m[0], pos };
  }
  throw new Error(`bad character '${src[pos]}' at ${pos}`);
}

// ---------- Parser state ----------
class Parser {
  private i = 0;
  private tokens: Token[];
  constructor(tokens: Token[]) { this.tokens = tokens; }
  peek(): Token { return this.tokens[this.i]; }
  next(): Token { return this.tokens[this.i++]; }
  expect(kind: string): Token {
    const t = this.next();
    if (t.kind !== kind) throw new Error(`expected ${kind} at ${t.pos}`);
    return t;
  }
}

function parse(src: string): Expr {
  const p = new Parser(tokenize(src));
  const e = parseExpr(p);
  p.expect("eof");
  return e;
}

// expr = "if" expr "then" expr "else" expr | compare ;
function parseExpr(p: Parser): Expr {
  if (p.peek().kind !== "if") return parseCompare(p);
  p.next();
  const cond = parseExpr(p);
  p.expect("then");
  const thenE = parseExpr(p);
  p.expect("else");
  return { kind: "if", cond, then: thenE, else: parseExpr(p) };
}

// compare = sum [ ">" sum ] ;
function parseCompare(p: Parser): Expr {
  const left = parseSum(p);
  if (p.peek().kind !== ">") return left;
  p.next();
  return { kind: "gt", left, right: parseSum(p) };
}

// sum = term { ("+" | "-") term } ;
function parseSum(p: Parser): Expr {
  let left = parseTerm(p);
  // FIX: Sum must process + and - instead of *.
  while (p.peek().kind === "+" || p.peek().kind === "-") {
    const op = p.next().kind;
    const right = parseTerm(p);
    if (op === "-") left = { kind: "sub", left, right };
    else left = { kind: "add", left, right };
  }
  return left;
}

// term = primary { "*" primary } ;
function parseTerm(p: Parser): Expr {
  let left = parsePrimary(p);
  // FIX: Term must process * instead of + and -.
  while (p.peek().kind === "*") {
    p.next();
    left = { kind: "mul", left, right: parsePrimary(p) };
  }
  return left;
}

// primary = INT | STRING | IDENT | "(" expr ")" ;
function parsePrimary(p: Parser): Expr {
  const t = p.next();
  switch (t.kind) {
    case "int":   return { kind: "int", value: Number(t.text) };
    case "str":   return { kind: "str", value: t.text.slice(1, -1) };
    case "ident": return { kind: "var", name: t.text };
    case "": { const e = parseExpr(p); return e; }
    // FIX: Parenthesized expressions must consume the closing parenthesis.
    case "(": { const e = parseExpr(p); p.expect(")"); return e; }
    default: throw new Error(`unexpected ${t.kind} at ${t.pos}`);
  }
}

// ---------- Type checker ----------
type Type = "int" | "string" | "bool";
type Env = { [variable: string]: Type | undefined };
class CheckError extends Error {}

function assertNever(x: never): never {
  throw new Error("check() has no case for: " + JSON.stringify(x));
}

function checkInts(e: { left: Expr; right: Expr }, env: Env, op: string): void {
  const l = check(e.left, env);
  const r = check(e.right, env);
  if (l !== "int" || r !== "int") throw new CheckError(`'${op}' needs int ${op} int, got ${l} ${op} ${r}`);
}

function check(e: Expr, env: Env): Type {
  switch (e.kind) {
    case "int": return "int";                                    // T-Int
    case "str": return "string";                                 // T-Str
    case "var": {                                                // T-Var
      const t = env[e.name];
      if (t === undefined) throw new CheckError(`unbound variable '${e.name}'`);
      return t;
    }
    case "add": {                                                // T-Add-Int, T-Add-Str
      const l = check(e.left, env);
      const r = check(e.right, env);
      if (l === "int" && r === "int") return "int";
      if (l === "string" && r === "string") return "string";
      throw new CheckError(`'+' needs int + int or string + string, got ${l} + ${r}`);
    }
    case "sub": checkInts(e, env, "-"); return "int";            // T-Sub
    // FIX: Missing multiplication case caused the type checker error.
    case "mul": checkInts(e, env, "*"); return "int";            // T-Mul
    case "gt":  checkInts(e, env, ">"); return "bool";           // T-Gt
    case "if": {                                                 // T-If
      const c = check(e.cond, env);
      if (c !== "bool") throw new CheckError(`if condition must be bool, got ${c}`);
      const t1 = check(e.then, env);
      const t2 = check(e.else, env);
      if (t1 !== t2) throw new CheckError(`if branches differ: then is ${t1}, else is ${t2}`);
      return t1;
    }
    default:
      return assertNever(e);
  }
}
