const MODULE_INTERNALS = "^modules/[^/]+/(lib|tests)/";
const PURE_LIB = "^modules/[^/]+/lib/(?!adapters/)";
const PURE_ENTRY = "^modules/[^/]+/index\\.ts$";
const NODE_SIDE = "^modules/[^/]+/(adapters\\.ts$|lib/adapters/)|^cli/";
const DETERMINISTIC_BUILTINS = "^(node:)?crypto$";

module.exports = {
  forbidden: [
    {
      name: "entry-points-only-across-modules",
      comment: "A module reaches another module only through its index.ts or adapters.ts.",
      severity: "error",
      from: { path: "^modules/([^/]+)/" },
      to: { path: MODULE_INTERNALS, pathNot: "^modules/$1/" },
    },
    {
      name: "entry-points-only-from-outside",
      comment: "The CLI, the package entry, scripts and the root suites reach a module only through its entries.",
      severity: "error",
      from: { pathNot: "^modules/" },
      to: { path: MODULE_INTERNALS },
    },
    {
      name: "module-tests-through-own-entry",
      comment: "A module's tests use its index.ts or adapters.ts, never its lib.",
      severity: "error",
      from: { path: "^modules/([^/]+)/tests/" },
      to: { path: "^modules/$1/lib/" },
    },
    {
      name: "tests-folder-is-private",
      comment: "Production code in a module never imports that module's tests.",
      severity: "error",
      from: { path: "^modules/([^/]+)/(?!tests/)" },
      to: { path: "^modules/$1/tests/" },
    },
    {
      name: "pure-lib-imports-no-node",
      comment: "Outside lib/adapters a module's lib uses no Node built-in except deterministic hashing.",
      severity: "error",
      from: { path: PURE_LIB },
      to: { dependencyTypes: ["core"], pathNot: DETERMINISTIC_BUILTINS },
    },
    {
      name: "pure-lib-imports-no-adapters",
      comment: "Outside lib/adapters a module's lib never reaches adapters or the CLI; it uses contracts.",
      severity: "error",
      from: { path: PURE_LIB },
      to: { path: NODE_SIDE },
    },
    {
      name: "index-stays-pure",
      comment: "A module's index.ts exports contracts and pure operations only; Node code goes behind adapters.ts.",
      severity: "error",
      from: { path: PURE_ENTRY },
      to: { path: "^modules/[^/]+/lib/adapters/|^modules/[^/]+/adapters\\.ts$" },
    },
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-undeclared-dependencies",
      severity: "error",
      from: {},
      to: { dependencyTypes: ["npm-no-pkg", "npm-unknown", "unknown", "undetermined"] },
    },
    {
      name: "no-unresolvable-imports",
      severity: "error",
      from: {},
      to: { couldNotResolve: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "^tests/quality/fixtures/" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: { extensions: [".ts", ".mjs", ".js", ".cjs"] },
  },
};
