import type {
	IDataObject,
	IExecuteFunctions,
	IBinaryKeyData,
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
	markdown?: string;
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
		const err = error as Error & {
			response?: {
				body?: unknown;
				data?: unknown;
				status?: number;
				statusText?: string;
			};
		};

		const response = err.response;

		if (response) {
			let body = response.body ?? response.data;

			if (typeof body === 'string') {
				try {
					body = JSON.parse(body);
				} catch {
					// body is not JSON
				}
			}

			const detail = (body as IDataObject | undefined)?.detail;

			if (detail) {
				return typeof detail === 'string'
					? detail
					: Array.isArray(detail)
						? detail.map((d) => (typeof d === 'object' ? JSON.stringify(d) : String(d))).join('; ')
						: JSON.stringify(detail);
			}

			if (response.status) {
				return `API returned ${response.status} ${response.statusText ?? ''}`.trim();
			}
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
				hint: 'Use "File" as Response Format in the HTTP Request node, then the binary field is "data"',
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

				if (fileBuffer.length === 0) {
					throw new NodeOperationError(
						this.getNode(),
						`The binary data in field "${inputBinaryField}" is empty. Make sure the previous node produced a valid file.`,
						{ itemIndex },
					);
				}

				const timeout = Number(options.timeout ?? 120000);
				const failOnEmptyOutput = options.failOnEmptyOutput !== false;
				const keepInputBinary = options.keepInputBinary === true;

				const headers: IDataObject = {};
				if (credentials.apiKey) {
					headers['x-api-key'] = credentials.apiKey;
				}

				const responseBody = (await this.helpers.httpRequest({
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
					timeout,
				} as never)) as unknown;

				let response: ConvertResponse;
				try {
					response = JSON.parse(typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody)) as ConvertResponse;
				} catch {
					throw new NodeOperationError(
						this.getNode(),
						`The API at ${baseUrl}/v1/convert returned an invalid response. Verify that the Base URL points to a running markitdown-api service.`,
						{ itemIndex },
					);
				}

				if (typeof response.markdown !== 'string') {
					throw new NodeOperationError(
						this.getNode(),
						'Invalid API response: the "markdown" field is missing in the response body.',
						{ itemIndex },
					);
				}

				if (failOnEmptyOutput && response.markdown.trim().length === 0) {
					throw new NodeOperationError(
						this.getNode(),
						'MarkItDown returned empty Markdown. The file may not contain extractable text or the format may be unsupported.',
						{ itemIndex },
					);
				}

				const json: IDataObject = {
					...items[itemIndex].json,
					[outputField]: response.markdown,
				};

				if (includeMetadata) {
					json.markitdownMetadata = response.metadata ?? {};
				}

				const binary: IBinaryKeyData | undefined = keepInputBinary
					? items[itemIndex].binary
					: undefined;

				returnData.push({
					json,
					binary,
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
