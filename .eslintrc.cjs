module.exports = {
	extends: ["google", "plugin:import/recommended", "plugin:@typescript-eslint/recommended", "prettier"],
	parser: "@typescript-eslint/parser",
	plugins: ["@typescript-eslint", "import"],
	overrides: [
		{
			files: ["functions/**/*.ts"],
			rules: {
				"@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
				"require-jsdoc": "off",
				"import/no-unresolved": "off"
			}
		}
	],
	ignorePatterns: ["functions/lib/**", "node_modules/**"],
	rules: {
		"max-len": ["warn", { code: 120, ignoreStrings: true, ignoreTemplateLiterals: true }]
	}
};
