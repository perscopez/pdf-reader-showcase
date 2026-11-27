/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const archiver = require('archiver');
const JSZip = require('jszip');

// Load .env.local if exists
const dotenvLocal = path.join(process.cwd(), '.env.local');
if (fs.existsSync(dotenvLocal)) {
  const content = fs.readFileSync(dotenvLocal, 'utf8');
  content.split('\n').forEach(line => {
    const match = /^\s*([^#=]+)\s*=\s*(.*)$/.exec(line);
    if (match) {
      const key = match[1].trim();
      let val = match[2].trim();
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
      process.env[key] = val;
    }
  });
}

const s3Endpoint = process.env.S3_ENDPOINT;
const s3AccessKeyId = process.env.S3_ACCESS_KEY_ID;
const s3SecretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
const s3BucketName = process.env.S3_BUCKET_NAME;
const s3Region = process.env.S3_REGION || 'us-east-1';
const backupEncryptionKey = process.env.BACKUP_ENCRYPTION_KEY;

function checkEnv() {
  const missing = [];
  if (!s3AccessKeyId) missing.push('S3_ACCESS_KEY_ID');
  if (!s3SecretAccessKey) missing.push('S3_SECRET_ACCESS_KEY');
  if (!s3BucketName) missing.push('S3_BUCKET_NAME');
  if (!backupEncryptionKey) missing.push('BACKUP_ENCRYPTION_KEY');

  if (missing.length > 0) {
    console.error('Error: Missing required environment variables:');
    missing.forEach(m => console.error(`  - ${m}`));
    process.exit(1);
  }
}

// Cryptography Helpers
function sha256(data) {
  return crypto.createHash('sha256').update(data).digest();
}

function hexSha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest();
}

function getSignatureKey(key, dateStamp, regionName, serviceName) {
  const kDate = hmac('AWS4' + key, dateStamp);
  const kRegion = hmac(kDate, regionName);
  const kService = hmac(kRegion, serviceName);
  const kSigning = hmac(kService, 'aws4_request');
  return kSigning;
}

// AWS SigV4 Request Caller
async function s3Request({ method, key, query = {}, body = null, headers = {} }) {
  const endpointUrl = s3Endpoint || `https://s3.${s3Region}.amazonaws.com`;
  const urlObj = new URL(endpointUrl);

  let host = urlObj.host;
  let requestPath = key ? `/${key}` : '/';

  // Determine path style or virtual host style S3 endpoint
  if (urlObj.hostname.endsWith('.amazonaws.com')) {
    host = `${s3BucketName}.s3.${s3Region}.amazonaws.com`;
  } else {
    requestPath = `/${s3BucketName}${requestPath}`;
  }

  const amzDate = new Date().toISOString().replace(/[:-]/g, '').split('.')[0] + 'Z';
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = body ? hexSha256(body) : hexSha256('');

  const rawHeaders = {
    'host': host,
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash,
    ...headers
  };

  const requestHeaders = {};
  Object.keys(rawHeaders).forEach(k => {
    if (rawHeaders[k] !== undefined && rawHeaders[k] !== null) {
      requestHeaders[k.toLowerCase()] = String(rawHeaders[k]).trim();
    }
  });

  const queryKeys = Object.keys(query).sort();
  const canonicalQuery = queryKeys.map(k => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`).join('&');

  const canonicalUri = encodeURI(requestPath);
  const headerKeys = Object.keys(requestHeaders).sort();
  const canonicalHeaders = headerKeys.map(k => `${k}:${requestHeaders[k]}`).join('\n') + '\n';
  const signedHeaders = headerKeys.join(';');

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join('\n');

  const credentialScope = `${dateStamp}/${s3Region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    hexSha256(canonicalRequest)
  ].join('\n');

  const signingKey = getSignatureKey(s3SecretAccessKey, dateStamp, s3Region, 's3');
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  const authorization = `AWS4-HMAC-SHA256 Credential=${s3AccessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const finalHeaders = {
    ...requestHeaders,
    'Authorization': authorization
  };
  if (body) {
    finalHeaders['Content-Length'] = Buffer.byteLength(body);
  }

  return new Promise((resolve, reject) => {
    const queryStr = canonicalQuery ? `?${canonicalQuery}` : '';
    const options = {
      method,
      hostname: urlObj.hostname.endsWith('.amazonaws.com') ? host : urlObj.hostname,
      port: urlObj.port || undefined,
      path: `${canonicalUri}${queryStr}`,
      headers: finalHeaders,
      timeout: 120000 // 2 minutes timeout for large uploads
    };

    // Handle custom endpoint protocols (HTTP vs HTTPS)
    const client = urlObj.protocol === 'http:' ? require('http') : https;

    const req = client.request(options, (res) => {
      let data = [];
      res.on('data', chunk => data.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(data);
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ statusCode: res.statusCode, headers: res.headers, body: buffer });
        } else {
          reject(new Error(`S3 request failed with status ${res.statusCode}: ${buffer.toString('utf8')}`));
        }
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

// Regex XML Parser for Listing S3 Files
function parseS3ListXml(xmlStr) {
  const contentsRegex = /<Contents>([\s\S]*?)<\/Contents>/g;
  const items = [];
  let match;
  while ((match = contentsRegex.exec(xmlStr)) !== null) {
    const content = match[1];
    const keyMatch = /<Key>(.*?)<\/Key>/.exec(content);
    const dateMatch = /<LastModified>(.*?)<\/LastModified>/.exec(content);
    const sizeMatch = /<Size>(\d+)<\/Size>/.exec(content);
    if (keyMatch && dateMatch) {
      items.push({
        key: keyMatch[1],
        lastModified: new Date(dateMatch[1]),
        size: sizeMatch ? parseInt(sizeMatch[1], 10) : 0
      });
    }
  }
  return items;
}

// Recurse directory helper
function getFilesRecursive(dir, baseDir = dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getFilesRecursive(fullPath, baseDir));
    } else {
      results.push({
        absolutePath: fullPath,
        relativePath: path.relative(baseDir, fullPath).replace(/\\/g, '/')
      });
    }
  });
  return results;
}

async function doBackup() {
  checkEnv();
  console.log('Starting S3 backup...');

  const stamp = new Date().toISOString().replace(/[:-]/g, '').split('.')[0] + 'Z';
  const tempZipPath = path.join(process.cwd(), 'data', `temp-backup-${stamp}.zip`);

  const output = fs.createWriteStream(tempZipPath);
  const archive = typeof archiver === 'function'
    ? archiver('zip', { zlib: { level: 6 } })
    : new archiver.ZipArchive({ zlib: { level: 6 } });

  archive.on('error', (err) => { throw err; });
  archive.pipe(output);

  // 1. Add database
  const dbFile = path.join(process.cwd(), 'data', 'library.db');
  if (fs.existsSync(dbFile)) {
    archive.file(dbFile, { name: 'library.db' });
  } else {
    console.warn('Warning: library.db not found!');
  }

  // 2. Add public uploads recursively
  const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
  const uploadFiles = getFilesRecursive(uploadsDir);
  console.log(`Adding ${uploadFiles.length} files from public/uploads to archive.`);
  for (const file of uploadFiles) {
    archive.file(file.absolutePath, { name: 'uploads/' + file.relativePath });
  }

  await archive.finalize();

  await new Promise((resolve) => {
    output.on('close', resolve);
  });

  console.log('Zip archive created successfully.');

  // 3. Read zip and encrypt
  const zipBuffer = fs.readFileSync(tempZipPath);
  
  // Clean up temp zip
  fs.unlinkSync(tempZipPath);

  console.log('Encrypting archive...');
  const salt = crypto.randomBytes(16);
  const derivedKey = crypto.pbkdf2Sync(backupEncryptionKey, salt, 100000, 32, 'sha256');
  const iv = crypto.randomBytes(16);

  const cipher = crypto.createCipheriv('aes-256-cbc', derivedKey, iv);
  const encrypted = Buffer.concat([cipher.update(zipBuffer), cipher.final()]);

  // Format: [16 bytes salt][16 bytes IV][encrypted payload]
  const payload = Buffer.concat([salt, iv, encrypted]);

  const s3ObjectKey = `pdf-library-backup-${stamp}.zip.enc`;
  console.log(`Uploading to S3 as ${s3ObjectKey} (${payload.length} bytes)...`);

  await s3Request({
    method: 'PUT',
    key: s3ObjectKey,
    body: payload,
    headers: {
      'Content-Type': 'application/octet-stream'
    }
  });

  console.log('Backup uploaded successfully!');

  // 4. Purge backups older than 30 days
  console.log('Checking for old backups to purge (> 30 days)...');
  try {
    const listRes = await s3Request({
      method: 'GET',
      query: {
        'list-type': '2',
        'prefix': 'pdf-library-backup-'
      }
    });

    const items = parseS3ListXml(listRes.body.toString('utf8'));
    const now = Date.now();
    const limit = 30 * 24 * 60 * 60 * 1000; // 30 days in ms

    for (const item of items) {
      const age = now - item.lastModified.getTime();
      if (age > limit) {
        console.log(`Purging expired S3 backup: ${item.key} (LastModified: ${item.lastModified.toISOString()})`);
        await s3Request({
          method: 'DELETE',
          key: item.key
        });
      }
    }
  } catch (err) {
    console.error('Warning: Failed to purge old backups:', err.message);
  }
}

async function doRestore(s3ObjectKey) {
  checkEnv();
  if (!s3ObjectKey) {
    console.error('Error: Please specify the S3 object key to restore.');
    console.error('Usage: node scripts/backup-s3.js restore <s3-object-key>');
    process.exit(1);
  }

  console.log(`Downloading ${s3ObjectKey} from S3...`);
  const downloadRes = await s3Request({
    method: 'GET',
    key: s3ObjectKey
  });

  const payload = downloadRes.body;
  if (payload.length < 32) {
    throw new Error('Invalid backup file. File size is too small.');
  }

  console.log('Decrypting backup archive...');
  const salt = payload.slice(0, 16);
  const iv = payload.slice(16, 32);
  const encryptedBytes = payload.slice(32);

  const derivedKey = crypto.pbkdf2Sync(backupEncryptionKey, salt, 100000, 32, 'sha256');
  const decipher = crypto.createDecipheriv('aes-256-cbc', derivedKey, iv);
  const zipBuffer = Buffer.concat([decipher.update(encryptedBytes), decipher.final()]);

  console.log('Extracting backup files...');
  const zip = await JSZip.loadAsync(zipBuffer);
  const files = Object.keys(zip.files);

  const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
  const dataDir = path.join(process.cwd(), 'data');

  fs.mkdirSync(uploadsDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });

  for (const filename of files) {
    const entry = zip.files[filename];
    if (entry.dir) continue;

    const data = await entry.async('nodebuffer');
    if (filename === 'library.db') {
      const dbPath = path.join(dataDir, 'library.db');
      fs.writeFileSync(dbPath, data);
      console.log(`Restored database: ${dbPath}`);
    } else if (filename.startsWith('uploads/')) {
      const relPath = filename.replace(/^uploads\//, '');
      const destPath = path.join(uploadsDir, relPath);
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, data);
      console.log(`Restored upload file: ${destPath}`);
    }
  }

  console.log('Restoration completed successfully!');
}

async function main() {
  const mode = process.argv[2];
  if (mode === 'backup') {
    await doBackup();
  } else if (mode === 'restore') {
    await doRestore(process.argv[3]);
  } else {
    console.error('Invalid arguments.');
    console.error('Usage:');
    console.error('  node scripts/backup-s3.js backup');
    console.error('  node scripts/backup-s3.js restore <s3-object-key>');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Backup/Restore operation failed:', err);
  process.exit(1);
});
