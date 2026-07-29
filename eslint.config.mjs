import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

export default tseslint.config(
	{ ignores: ['main.js', 'node_modules/', 'test-vault/'] },
	...tseslint.configs.recommended,
	eslintConfigPrettier,
	{
		rules: {
			'@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
			'@typescript-eslint/consistent-type-imports': 'error',
		},
	},
);
