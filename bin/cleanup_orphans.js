#!/usr/bin/env node
/**
 * cleanup_orphans.js
 *
 * CLI maintenance script to remove orphaned FanFan records from Redis.
 *
 * It scans for job request keys ("fanfan-<jobId>-request") and, for each one,
 * deletes every associated key (see src/cache_keys.js) when EITHER:
 *   (a) the job is very old  - its start time is older than MAX_AGE_DAYS, or
 *   (b) the stored job request no longer passes validation.
 *
 * A missing/unparseable start time is treated as "very old" (an orphan we
 * can no longer reason about), so its keys are cleaned up too.
 *
 * NOTE ON SCANNING:
 *   Request keys are top-level Redis STRING keys, not members of a set, so we
 *   use SCAN (with a MATCH pattern) to find them.
 *
 * By default the script runs in DRY-RUN mode and only reports what it would
 * delete. Pass --commit to actually delete keys.
 *
 * Usage:
 *   node bin/cleanup_orphans.js [--commit] [--days=30]
 *
 *   --commit        Actually delete keys (default is a non-destructive dry run).
 *   --days=<n>      Override the max age in days (default 30).
 */

const {createClient} = require('@redis/client');
const appConfig = require('../src/config.js');
const cacheKeys = require('../src/cache_keys.js');
const validator = require('../src/validate.js');

const SCAN_MATCH = 'fanfan-*-request';
const SCAN_COUNT = 250;
const KEY_PREFIX = 'fanfan-';
const KEY_SUFFIX = '-request';

// --- CLI args -------------------------------------------------------------

const parseArgs = (argv) => {
    const opts = {commit: false, days: 30};
    for (const arg of argv) {
        if (arg === '--commit') {
            opts.commit = true;
        } else if (arg === '--dry-run') {
            opts.commit = false;
        } else if (arg.startsWith('--days=')) {
            const days = parseInt(arg.slice('--days='.length), 10);
            if (Number.isNaN(days) || days < 0) {
                throw new Error(`Invalid --days value: ${arg}`);
            }
            opts.days = days;
        } else if (arg === '--help' || arg === '-h') {
            opts.help = true;
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }
    return opts;
};

const usage = () => {
    console.log('Usage: node bin/cleanup_orphans.js [--commit] [--days=30]');
    console.log('  --commit     Actually delete keys (default: dry run).');
    console.log('  --days=<n>   Max job age in days before it is considered old (default: 30).');
};

// --- Helpers --------------------------------------------------------------

/**
 * Extract the jobId from a request key. jobIds are UUIDs (which contain
 * dashes), so we strip the known prefix/suffix rather than splitting on '-'.
 */
const jobIdFromRequestKey = (key) => {
    return key.slice(KEY_PREFIX.length, key.length - KEY_SUFFIX.length);
};

/** All Redis keys associated with a job (see src/cache_keys.js). */
const allKeysForJob = (jobId) => {
    return [...cacheKeys.coreKeys(jobId), ...cacheKeys.countKeys(jobId)];
};

/**
 * Decide whether a job is an orphan. Returns a reason string when it should be
 * cleaned up, or null when it should be kept.
 */
const orphanReason = (startRaw, requestRaw, maxAgeMs, now) => {
    const startMs = parseInt(startRaw, 10);
    if (!startRaw || Number.isNaN(startMs)) {
        return 'missing/invalid start time';
    }
    if ((now - startMs) > maxAgeMs) {
        const ageDays = Math.floor((now - startMs) / (24 * 60 * 60 * 1000));
        return `too old (${ageDays} days)`;
    }

    // Not old - only clean up if the stored request fails validation.
    try {
        validator.validateJobRequest(JSON.parse(requestRaw));
    } catch (error) {
        return `failed validation (${error.message})`;
    }
    return null;
};

// --- Main -----------------------------------------------------------------

const main = async () => {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) {
        usage();
        return 0;
    }

    const maxAgeMs = opts.days * 24 * 60 * 60 * 1000;
    const now = Date.now();

    const redisClient = createClient({
        url: `redis://${appConfig.redis_host}:${appConfig.redis_port}`
    });
    redisClient.on('error', (err) => console.error('Redis Client Error:', err.message));
    await redisClient.connect();

    console.log(`Connected to redis://${appConfig.redis_host}:${appConfig.redis_port}`);
    console.log(`Mode: ${opts.commit ? 'COMMIT (deleting)' : 'DRY-RUN (no changes)'} | max age: ${opts.days} days`);

    const stats = {scanned: 0, orphaned: 0, deletedKeys: 0};

    try {
        for await (const key of redisClient.scanIterator({MATCH: SCAN_MATCH, COUNT: SCAN_COUNT})) {
            stats.scanned++;
            const jobId = jobIdFromRequestKey(key);

            const [startRaw, requestRaw] = await redisClient.mGet([
                cacheKeys.coreKeys(jobId)[0], // fanfan-<jobId>-start
                key                            // fanfan-<jobId>-request
            ]);

            const reason = orphanReason(startRaw, requestRaw, maxAgeMs, now);
            if (!reason) {
                continue;
            }

            stats.orphaned++;
            const keys = allKeysForJob(jobId);
            console.log(`${opts.commit ? 'DELETE' : 'WOULD DELETE'} job ${jobId} - ${reason}`);

            if (opts.commit) {
                const removed = await redisClient.del(keys);
                stats.deletedKeys += removed;
            } else {
                stats.deletedKeys += keys.length;
            }
        }

        console.log('---');
        console.log(`Scanned request keys : ${stats.scanned}`);
        console.log(`Orphaned jobs        : ${stats.orphaned}`);
        console.log(`Keys ${opts.commit ? 'deleted        ' : 'that would go  '}: ${stats.deletedKeys}`);
        if (!opts.commit && stats.orphaned > 0) {
            console.log('Re-run with --commit to delete these keys.');
        }
    } finally {
        await redisClient.quit();
    }

    return 0;
};

main()
    .then((code) => process.exit(code))
    .catch((error) => {
        console.error('Fatal:', error.message);
        process.exit(1);
    });
