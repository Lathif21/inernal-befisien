// Neon Object Storage (S3-compatible) for files written in the Email page (P3-08). Relative imports
// only: shared with Trigger.dev. The config is passed in: the app reads NEON_STORAGE_* from
// $app/env/private (Vercel reserves the AWS_* names), the task reads process.env.
import {
	DeleteObjectsCommand,
	GetObjectCommand,
	HeadObjectCommand,
	PutBucketCorsCommand,
	PutObjectCommand,
	S3Client
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export type StorageConfig = {
	accessKeyId: string;
	secretAccessKey: string;
	/** The branch's S3 endpoint (AWS_ENDPOINT_URL_S3 from `neon env pull`) */
	endpoint: string;
	region: string;
	bucket: string;
};

/** What the services need from the bucket; tests pass an in-memory fake */
export type FileStorage = {
	/** A presigned PUT the browser uploads the file to (Content-Type must match) */
	uploadUrl(key: string, contentType: string, expiresIn?: number): Promise<string>;
	/** Size of a stored object, or null when it is not there */
	size(key: string): Promise<number | null>;
	read(key: string): Promise<Uint8Array>;
	/** A presigned GET that downloads under `filename` */
	downloadUrl(key: string, filename: string, expiresIn?: number): Promise<string>;
	remove(keys: string[]): Promise<void>;
};

export const EMAIL_FILES_BUCKET = 'email-files';

/** NEON_STORAGE_* first, then the AWS_* names `neon env pull` writes locally; null when unset */
export function storageConfig(env: Record<string, string | undefined>): StorageConfig | null {
	const pick = (own: string, aws: string) => env[own] || env[aws] || '';
	const config = {
		accessKeyId: pick('NEON_STORAGE_ACCESS_KEY_ID', 'AWS_ACCESS_KEY_ID'),
		secretAccessKey: pick('NEON_STORAGE_SECRET_ACCESS_KEY', 'AWS_SECRET_ACCESS_KEY'),
		endpoint: pick('NEON_STORAGE_ENDPOINT', 'AWS_ENDPOINT_URL_S3'),
		region: pick('NEON_STORAGE_REGION', 'AWS_REGION') || 'us-east-2',
		bucket: env.NEON_STORAGE_BUCKET || EMAIL_FILES_BUCKET
	};
	return config.accessKeyId && config.secretAccessKey && config.endpoint ? config : null;
}

/** RFC 6266: an ASCII fallback plus the UTF-8 name, so "Penawaran – Q3.pdf" keeps its dash */
export function contentDisposition(filename: string) {
	const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
	return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export function neonStorage(config: StorageConfig): FileStorage {
	const s3 = new S3Client({
		region: config.region,
		endpoint: config.endpoint,
		credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
		// Neon requires path-style addressing
		forcePathStyle: true
	});
	const Bucket = config.bucket;
	return {
		uploadUrl: (key, contentType, expiresIn = 3600) =>
			getSignedUrl(s3, new PutObjectCommand({ Bucket, Key: key, ContentType: contentType }), {
				expiresIn
			}),
		async size(key) {
			try {
				const head = await s3.send(new HeadObjectCommand({ Bucket, Key: key }));
				return head.ContentLength ?? 0;
			} catch (e) {
				const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
				if (status === 404) return null;
				throw e;
			}
		},
		async read(key) {
			const res = await s3.send(new GetObjectCommand({ Bucket, Key: key }));
			if (!res.Body) throw new Error(`empty object ${key}`);
			return res.Body.transformToByteArray();
		},
		downloadUrl: (key, filename, expiresIn = 3600) =>
			getSignedUrl(
				s3,
				new GetObjectCommand({
					Bucket,
					Key: key,
					ResponseContentDisposition: contentDisposition(filename)
				}),
				{ expiresIn }
			),
		async remove(keys) {
			for (let i = 0; i < keys.length; i += 1000)
				await s3.send(
					new DeleteObjectsCommand({
						Bucket,
						Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })), Quiet: true }
					})
				);
		}
	};
}

/** Let the app's pages upload straight to the bucket (browser PUT with a presigned URL) */
export async function allowBrowserUploads(config: StorageConfig, origins: string[]) {
	const s3 = new S3Client({
		region: config.region,
		endpoint: config.endpoint,
		credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
		forcePathStyle: true
	});
	await s3.send(
		new PutBucketCorsCommand({
			Bucket: config.bucket,
			CORSConfiguration: {
				CORSRules: [
					{
						AllowedOrigins: origins,
						AllowedMethods: ['PUT'],
						AllowedHeaders: ['content-type'],
						ExposeHeaders: ['ETag'],
						MaxAgeSeconds: 3600
					}
				]
			}
		})
	);
}
