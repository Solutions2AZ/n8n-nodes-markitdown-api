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

function sanitizeFilename(filename: string): string {
	return filename.replace(/[\r\n"]/g, '_').slice(0, 255) || 'document';
}

function buildMultipartBody(
	fieldName: string,
	fileBuffer: Buffer,
	filename: string,
	contentType: string,
): { body: Buffer; contentTypeHeader: string } {
	const boundary = `----n8nMarkitdown${Date.now()}${Math.random().toString(16).slice(2)}`;

	const header = Buffer.from(
		`--${boundary}\r\n` +
			`Content-Disposition: form-data; name="${fieldName}"; filename="${sanitizeFilename(filename)}"\r\n` +
			`Content-Type: ${contentType}\r\n\r\n`,
		'utf-8',
	);

	const footer = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8');

	return {
		body: Buffer.concat([header, fileBuffer, footer]),
		contentTypeHeader: `multipart/form-data; boundary=${boundary}`,
	};
}

function extractErrorMessage(error: unknown): string {
	if (error instanceof Error) {
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

				const filename = binaryData.fileName ?? 'document';
				const mimeType = binaryData.mimeType ?? 'application/octet-stream';

				const { body: multipartBody, contentTypeHeader } = buildMultipartBody(
					'file',
					fileBuffer,
					filename,
					mimeType,
				);

				const requestHeaders: Record<string, string> = {
					'Content-Type': contentTypeHeader,
				};

				if (credentials.apiKey) {
					requestHeaders['x-api-key'] = credentials.apiKey;
				}

				const controller = new AbortController();
				const timeoutId = setTimeout(() => controller.abort(), timeout);

				let response: Response;
				try {
					response = await fetch(`${baseUrl}/v1/convert`, {
						method: 'POST',
						headers: requestHeaders,
						body: multipartBody,
						signal: controller.signal,
					});
				} catch (fetchError) {
					if (fetchError instanceof Error && fetchError.name === 'AbortError') {
						throw new NodeOperationError(
							this.getNode(),
							`Request to ${baseUrl}/v1/convert timed out after ${timeout}ms. Check that the markitdown-api service is running and reachable.`,
							{ itemIndex },
						);
					}
					throw new NodeOperationError(
						this.getNode(),
						`Could not connect to ${baseUrl}/v1/convert. Verify the Base URL in your credentials and that the markitdown-api service is running. Error: ${extractErrorMessage(fetchError)}`,
						{ itemIndex },
					);
				} finally {
					clearTimeout(timeoutId);
				}

				const responseText = await response.text();

				if (!response.ok) {
					let detail = responseText;
					try {
						const parsed = JSON.parse(responseText) as IDataObject;
						const d = parsed.detail;
						if (d) {
							detail = typeof d === 'string' ? d : JSON.stringify(d);
						}
					} catch {
						// responseText is not JSON
					}

					if (response.status === 401) {
						throw new NodeOperationError(
							this.getNode(),
							`Authentication failed (401). Check that the API Key in your credentials matches the MARKITDOWN_API_KEY of the markitdown-api service.`,
							{ itemIndex },
						);
					}

					if (response.status === 413) {
						throw new NodeOperationError(
							this.getNode(),
							`File is too large (413). The markitdown-api service rejected the file. Increase MAX_UPLOAD_BYTES if needed.`,
							{ itemIndex },
						);
					}

					throw new NodeOperationError(
						this.getNode(),
						`API error ${response.status} from ${baseUrl}/v1/convert: ${detail}`,
						{ itemIndex },
					);
				}

				let parsedResponse: ConvertResponse;
				try {
					parsedResponse = JSON.parse(responseText) as ConvertResponse;
				} catch {
					throw new NodeOperationError(
						this.getNode(),
						`The API at ${baseUrl}/v1/convert returned an invalid JSON response. Verify that the Base URL points to a running markitdown-api service.`,
						{ itemIndex },
					);
				}

				if (typeof parsedResponse.markdown !== 'string') {
					throw new NodeOperationError(
						this.getNode(),
						'Invalid API response: the "markdown" field is missing in the response body.',
						{ itemIndex },
					);
				}

				if (failOnEmptyOutput && parsedResponse.markdown.trim().length === 0) {
					throw new NodeOperationError(
						this.getNode(),
						'MarkItDown returned empty Markdown. The file may not contain extractable text or the format may be unsupported.',
						{ itemIndex },
					);
				}

				const json: IDataObject = {
					...items[itemIndex].json,
					[outputField]: parsedResponse.markdown,
				};

				if (includeMetadata) {
					json.markitdownMetadata = parsedResponse.metadata ?? {};
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

				if (error instanceof NodeOperationError) {
					throw error;
				}

				throw new NodeOperationError(this.getNode(), extractErrorMessage(error), {
					itemIndex,
				});
			}
		}

		return [returnData];
	}
}
