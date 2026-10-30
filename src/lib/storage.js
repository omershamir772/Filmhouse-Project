const fs = require('node:fs/promises');
const path = require('node:path');

// Where processed set photos live. Locally they go to ./uploads; in production to Cloudflare R2,
// served from its own domain so an uploaded file can never run as part of the site.

function createStorage(config) {
  return config.driver === 'r2' ? r2Storage(config.r2) : localStorage(config.uploadDir);
}

const SAFE_KEY = /^[a-z0-9/_-]+\.(webp|jpg|png)$/;

function localStorage(dir) {
  const root = path.resolve(dir);
  const file = (key) => {
    if (!SAFE_KEY.test(key)) throw new Error('Invalid storage key');
    return path.join(root, key);
  };
  return {
    driver: 'local',
    root,
    publicOrigin: null,
    async put(key, buffer) {
      await fs.mkdir(path.dirname(file(key)), { recursive: true });
      await fs.writeFile(file(key), buffer);
    },
    async remove(key) {
      await fs.rm(file(key), { force: true });
    },
    url: (key) => `/uploads/${key}`,
  };
}

function r2Storage({ accountId, accessKeyId, secretAccessKey, bucket, publicUrl }) {
  const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  return {
    driver: 'r2',
    publicOrigin: new URL(publicUrl).origin,
    async put(key, buffer, contentType) {
      if (!SAFE_KEY.test(key)) throw new Error('Invalid storage key');
      await client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000, immutable',
      }));
    },
    async remove(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
    url: (key) => `${publicUrl}/${key}`,
  };
}

module.exports = { createStorage };
