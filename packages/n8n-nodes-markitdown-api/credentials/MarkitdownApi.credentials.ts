import type { ICredentialTestRequest, ICredentialType, INodeProperties } from 'n8n-workflow';

export class MarkitdownApi implements ICredentialType {
	name = 'markitdownApi';
	displayName = 'MarkItDown API';
	documentationUrl = 'https://github.com/microsoft/markitdown';

	properties: INodeProperties[] = [
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'http://markitdown-api:8000',
			required: true,
			description: 'Base URL of the self-hosted markitdown-api service',
		},
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			description: 'Optional API key sent as x-api-key',
		},
	];

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/health',
			method: 'GET',
		},
	};
}
