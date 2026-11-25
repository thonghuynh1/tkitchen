import { readFileSync } from "node:fs";

const CONTEXT_FILE = new URL("../../CONTEXT.md", import.meta.url);
const TERM_LINE = /^\*\*(.+?)\*\*:\s*$/;
const AVOID_LINE = /^_Avoid_:\s*(.+)$/;
const ID_NAME = /(^id|Id)$/;
const MODULE_ENTRY = /[\\/]src[\\/]modules[\\/][^\\/]+[\\/](index|adapters)\.ts$/;
const BARE_ID_TYPES = new Set(["TSStringKeyword", "TSNumberKeyword"]);
const FUNCTION_TYPES = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression", "TSDeclareFunction", "TSMethodSignature", "TSFunctionType"]);

export function avoidedTerms(text) {
  const terms = [];
  let term = "";
  for (const line of text.split(/\r?\n/)) {
    const named = TERM_LINE.exec(line);
    if (named) term = named[1];
    const avoid = AVOID_LINE.exec(line);
    if (!avoid) continue;
    for (const item of avoid[1].replaceAll(/\([^)]*\)/g, "").split(",")) {
      const words = item.trim().toLowerCase().split(/\s+/).filter(Boolean);
      if (words.length) terms.push({ term, phrase: words.join(" "), words });
    }
  }
  return terms;
}

export function identifierWords(name) {
  return name
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[\s_$-]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
}

function sameWord(word, avoided) {
  return word === avoided || word === avoided + "s" || word === avoided + "es";
}

export function avoidedIn(name, terms) {
  const words = identifierWords(name);
  for (const avoided of terms) {
    for (let start = 0; start + avoided.words.length <= words.length; start++) {
      if (avoided.words.every((word, offset) => sameWord(words[start + offset], word))) return avoided;
    }
  }
  return undefined;
}

let cachedTerms;
function contextTerms() {
  cachedTerms ??= avoidedTerms(readFileSync(CONTEXT_FILE, "utf8"));
  return cachedTerms;
}

function declaredName(node) {
  if (!node) return undefined;
  if (node.type === "Identifier") return node;
  if (node.type === "AssignmentPattern") return declaredName(node.left);
  if (node.type === "TSParameterProperty") return declaredName(node.parameter);
  return undefined;
}

function isTypeParameterInScope(node, name) {
  for (let current = node.parent; current; current = current.parent) {
    const params = current.typeParameters?.params ?? [];
    if (params.some((param) => param.name?.name === name || param.name === name)) return true;
  }
  return false;
}

function allowedCast(node) {
  const target = node.typeAnnotation;
  if (target?.type !== "TSTypeReference" || target.typeName?.type !== "Identifier") return false;
  const name = target.typeName.name;
  return name === "const" || isTypeParameterInScope(node, name);
}

function reExportSource(statement) {
  if (statement.type === "ExportAllDeclaration") return statement.source.value;
  if (statement.type === "ExportNamedDeclaration" && statement.source && !statement.declaration) return statement.source.value;
  if (statement.type === "ImportDeclaration") return statement.source.value;
  if (statement.type === "ExportNamedDeclaration" && !statement.source && !statement.declaration) return null;
  return undefined;
}

function bareType(annotation) {
  return BARE_ID_TYPES.has(annotation?.typeAnnotation?.type);
}

const contextTermsRule = {
  meta: {
    type: "suggestion",
    docs: { description: "Disallow identifiers that use a word CONTEXT.md lists under _Avoid_." },
    schema: [],
    messages: { avoided: "\"{{name}}\" uses \"{{phrase}}\", which CONTEXT.md avoids; the term is {{term}}." },
  },
  create(context) {
    const terms = contextTerms();
    function check(node) {
      const id = declaredName(node);
      if (!id) return;
      const found = avoidedIn(id.name, terms);
      if (found) context.report({ node: id, messageId: "avoided", data: { name: id.name, phrase: found.phrase, term: found.term } });
    }
    function checkKey(node) {
      if (!node.computed) check(node.key);
    }
    function checkParams(node) {
      for (const param of node.params ?? []) check(param);
    }
    return {
      VariableDeclarator: (node) => check(node.id),
      FunctionDeclaration: (node) => { check(node.id); checkParams(node); },
      FunctionExpression: checkParams,
      ArrowFunctionExpression: checkParams,
      ClassDeclaration: (node) => check(node.id),
      TSInterfaceDeclaration: (node) => check(node.id),
      TSTypeAliasDeclaration: (node) => check(node.id),
      TSEnumDeclaration: (node) => check(node.id),
      TSPropertySignature: checkKey,
      PropertyDefinition: checkKey,
      MethodDefinition: checkKey,
      TSMethodSignature: (node) => { checkKey(node); checkParams(node); },
    };
  },
};

const noUnsafeAsRule = {
  meta: {
    type: "problem",
    docs: { description: "Disallow type casts other than as const and casts to a generic type parameter." },
    schema: [],
    messages: { cast: "Do not cast with as; narrow with a type guard, or cast only to const or a type parameter." },
  },
  create(context) {
    function check(node) {
      if (!allowedCast(node)) context.report({ node, messageId: "cast" });
    }
    return { TSAsExpression: check, TSTypeAssertion: check };
  },
};

const noPassThroughRule = {
  meta: {
    type: "suggestion",
    docs: { description: "Disallow a file whose only content re-exports one other file; module entries are exempt." },
    schema: [],
    messages: { passThrough: "This file only re-exports {{source}}; import that file instead." },
  },
  create(context) {
    return {
      Program(node) {
        if (MODULE_ENTRY.test(context.filename) || node.body.length === 0) return;
        const sources = new Set();
        for (const statement of node.body) {
          const source = reExportSource(statement);
          if (source === undefined) return;
          if (source !== null) sources.add(source);
        }
        if (sources.size === 1) context.report({ node, messageId: "passThrough", data: { source: [...sources][0] } });
      },
    };
  },
};

const brandedIdsRule = {
  meta: {
    type: "suggestion",
    docs: { description: "Disallow bare string or number for exported *Id types and *Id parameters." },
    schema: [],
    messages: { bare: "\"{{name}}\" is a bare {{type}}; give the id a branded type." },
  },
  create(context) {
    function report(node, name, type) {
      context.report({ node, messageId: "bare", data: { name, type: type === "TSStringKeyword" ? "string" : "number" } });
    }
    function checkParams(node) {
      for (const param of node.params ?? []) {
        const id = declaredName(param);
        if (id && ID_NAME.test(id.name) && bareType(id.typeAnnotation)) report(id, id.name, id.typeAnnotation.typeAnnotation.type);
      }
    }
    const visitors = {
      TSTypeAliasDeclaration(node) {
        if (node.parent?.type !== "ExportNamedDeclaration") return;
        if (ID_NAME.test(node.id.name) && BARE_ID_TYPES.has(node.typeAnnotation.type)) report(node.id, node.id.name, node.typeAnnotation.type);
      },
    };
    for (const type of FUNCTION_TYPES) visitors[type] = checkParams;
    return visitors;
  },
};

const plugin = {
  meta: { name: "design" },
  rules: {
    "context-terms": contextTermsRule,
    "no-unsafe-as": noUnsafeAsRule,
    "no-pass-through": noPassThroughRule,
    "branded-ids": brandedIdsRule,
  },
};

export default plugin;
