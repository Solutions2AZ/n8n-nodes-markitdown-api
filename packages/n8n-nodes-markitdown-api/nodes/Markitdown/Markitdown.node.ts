import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

interface MarkitdownCredentials {
	baseUrl: string;
	apiKey?: string;
}

interface ConvertResponse {
	markdown?: unknown;
	metadata?: IDataObject;
}

function normalizeBaseUrl(baseUrl: string): string {
	const normalized = baseUrl.trim().replace(/\/+$/, '');

	if (!normalized) {
		throw new Error('Base URL is required');
	}

	return normalized;
}

function extractErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		const response = (error as Error & { response?: { body?: IDataObject; data?: IDataObject } }).response;
		const detail = response?.body?.detail ?? response?.data?.detail;

		if (detail) {
			return typeof detail === 'string' ? detail : JSON.stringify(detail);
		}

		return error.message;
	}

	return String(error);
}

export class Markitdown implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'MarkItDown',
		name: 'markitdownApi',
		icon: 'file:markitdown.svg',
		group: ['transform'],
		version: 1,
		description: 'Convert files to Markdown using a self-hosted MarkItDown API',
		defaults: {
			name: 'MarkItDown',
		},
		inputs: ['main'] as never,
		outputs: ['main'] as never,
		credentials: [
			{
				name: 'markitdownApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Convert File to Markdown',
						value: 'convertFile',
						action: 'Convert a file to Markdown',
					},
				],
				default: 'convertFile',
			},
			{
				displayName: 'Input Binary Field',
				name: 'inputBinaryField',
				type: 'string',
				default: 'data',
				required: true,
				description: 'Name of the binary property containing the file to convert',
			},
			{
				displayName: 'Output Field',
				name: 'outputField',
				type: 'string',
				default: 'markdown',
				required: true,
				description: 'JSON field where the converted Markdown will be stored',
			},
			{
				displayName: 'Include Metadata',
				name: 'includeMetadata',
				type: 'boolean',
				default: true,
				description: 'Whether to include conversion metadata in markitdownMetadata',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Fail On Empty Output',
						name: 'failOnEmptyOutput',
						type: 'boolean',
						default: true,
						description: 'Whether to fail if the API returns empty Markdown',
					},
					{
						displayName: 'Keep Input Binary',
						name: 'keepInputBinary',
						type: 'boolean',
						default: false,
						description: 'Whether to keep the original binary data on the output item',
					},
					{
						displayName: 'Timeout',
						name: 'timeout',
						type: 'number',
						default: 120000,
						typeOptions: {
							minValue: 1000,
						},
						description: 'Request timeout in milliseconds',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const credentials = (await this.getCredentials('markitdownApi')) as unknown as MarkitdownCredentials;
		const baseUrl = normalizeBaseUrl(credentials.baseUrl);
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const inputBinaryField = this.getNodeParameter('inputBinaryField', itemIndex) as string;
				const outputField = this.getNodeParameter('outputField', itemIndex) as string;
				const includeMetadata = this.getNodeParameter('includeMetadata', itemIndex) as boolean;
				const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;

				const binaryData = this.helpers.assertBinaryData(itemIndex, inputBinaryField);
				const fileBuffer = await this.helpers.getBinaryDataBuffer(itemIndex, inputBinaryField);
				const timeout = Number(options.timeout ?? 120000);
				const failOnEmptyOutput = options.failOnEmptyOutput !== false;
				const keepInputBinary = options.keepInputBinary === true;

				const headers: IDataObject = {};
				if (credentials.apiKey) {
					headers['x-api-key'] = credentials.apiKey;
				}

				const response = (await this.helpers.httpRequest({
					method: 'POST',
					url: `${baseUrl}/v1/convert`,
					headers,
					formData: {
						file: {
							value: fileBuffer,
							options: {
								filename: binaryData.fileName ?? 'document',
								contentType: binaryData.mimeType ?? 'application/octet-stream',
							},
						},
					},
					json: true,
					timeout,
				} as never)) as ConvertResponse;

				if (typeof response.markdown !== 'string') {
					throw new NodeOperationError(this.getNode(), 'Invalid API response: markdown is missing', {
						itemIndex,
					});
				}

				if (failOnEmptyOutput && response.markdown.trim().length === 0) {
					throw new NodeOperationError(this.getNode(), 'MarkItDown returned empty Markdown', {
						itemIndex,
					});
				}

				const json: IDataObject = {
					...items[itemIndex].json,
					[outputField]: response.markdown,
				};

				if (includeMetadata) {
					json.markitdownMetadata = response.metadata ?? {};
				}

				returnData.push({
					json,
					binary: keepInputBinary ? items[itemIndex].binary : undefined,
					pairedItem: {
						item: itemIndex,
					},
				});
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: {
							...items[itemIndex].json,
							error: extractErrorMessage(error),
						},
						pairedItem: {
							item: itemIndex,
						},
					});
					continue;
				}

				throw new NodeOperationError(this.getNode(), extractErrorMessage(error), {
					itemIndex,
				});
			}
		}

		return [returnData];
	}
}
