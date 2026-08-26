import js from '@eslint/js';
import eslintReact from '@eslint-react/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
	{
		ignores: ['main.js', 'styles.css', '.test-build/', 'node_modules/'],
	},
	js.configs.recommended,
	tseslint.configs.recommendedTypeChecked,
	eslintReact.configs['recommended-typescript'],
	reactHooks.configs.flat['recommended-latest'],
	{
		languageOptions: {
			globals: { ...globals.browser, ...globals.node },
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			'no-unused-vars': 'off',
			'@typescript-eslint/no-unused-vars': ['error', { args: 'none' }],
			'@typescript-eslint/ban-ts-comment': 'off',
			'no-prototype-builtins': 'off',
			'@typescript-eslint/no-empty-function': 'off',
		},
	},
	{
		files: ['**/*.mjs'],
		extends: [tseslint.configs.disableTypeChecked],
	}
);
