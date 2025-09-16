module.exports = {
  root: true,
  env: {
    es6: true,
    node: true,
  },
  extends: [
    "eslint:recommended",
    "plugin:import/errors",
    "plugin:import/warnings",
    "plugin:import/typescript",
    "google",
    "plugin:@typescript-eslint/recommended",
  ],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: ["tsconfig.json", "tsconfig.dev.json"],
    sourceType: "module",
  },
  ignorePatterns: [
    "/lib/**/*", // Ignore built files.
    "/generated/**/*", // Ignore generated files.
    "/coverage/**/*", // Ignore coverage files.
    "jest.config.js", // Ignore jest config.
    "jest.unit.config.js", // Ignore unit jest config.
  ],
  plugins: [
    "@typescript-eslint",
    "import",
  ],
  rules: {
    // Критические ошибки - оставляем
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/no-unused-vars": "error",
    "@typescript-eslint/no-non-null-assertion": "error",
    "@typescript-eslint/prefer-nullish-coalescing": "off",
    "@typescript-eslint/prefer-optional-chain": "error",
    "@typescript-eslint/no-namespace": "off",
    
    // Стилистические ошибки - отключаем
    "quotes": "off",
    "linebreak-style": "off",
    "max-len": "off",
    "indent": "off",
    "object-curly-spacing": "off",
    "comma-dangle": "off",
    "semi": "off",
    "space-before-function-paren": "off",
    "require-jsdoc": "off",
    "valid-jsdoc": "off",
    "new-cap": "off",
    "camelcase": "off",
    "no-multiple-empty-lines": "off",
    "eol-last": "off",
    "no-trailing-spaces": "off",
    "padded-blocks": "off",
    "brace-style": "off",
    "key-spacing": "off",
    "comma-spacing": "off",
    "space-infix-ops": "off",
    "space-before-blocks": "off",
    "keyword-spacing": "off",
    "space-in-parens": "off",
    "array-bracket-spacing": "off",
    "computed-property-spacing": "off",
    "func-call-spacing": "off",
    "no-multi-spaces": "off",
    "no-whitespace-before-property": "off",
    "rest-spread-spacing": "off",
    "template-curly-spacing": "off",
    "yield-star-spacing": "off",
    "import/no-unresolved": 0,
    
    // Дублирующиеся экспорты - отключаем
    "import/export": "off",
  },
  overrides: [
    {
      // Для тестовых файлов - более мягкие правила
      files: [
        "**/*.test.ts",
        "**/*.spec.ts",
        "**/tests/**/*.ts",
        "**/__tests__/**/*.ts",
        "**/__tests__/**/*.tsx"
      ],
      env: {
        jest: true,
        node: true,
      },
      rules: {
        "@typescript-eslint/no-explicit-any": "off",
        "@typescript-eslint/no-unused-vars": "off",
        "import/export": "off",
        "arrow-parens": "off",
        "@typescript-eslint/prefer-optional-chain": "off",
        "@typescript-eslint/no-var-requires": "off",
        "@typescript-eslint/no-inferrable-types": "off",
        "prefer-const": "off",
        "no-var": "off",
      },
    },
  ],
};
