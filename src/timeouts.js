const appConfig = require('./config.js');
const logger = require('./logger.js');
const redisClient = require('./redis.js');
const outcomeBuilder = require('./job_outcome.js');
const TIMEOUT_SET_KEY = 'fanfan-timeouts';
const timeouts = {};

const registerTimeout = (jobId, timeout) => {
    timeouts[jobId] = setTimeout(() => {
        logger.info(`Job [${jobId}] timeout expired`);
        outcomeBuilder.runForTimeout(jobId);
        purgeTimeout(jobId);
    }, timeout * 1000);
};

const persistTimeout = (jobId, timeout) => {
    const timeoutTimestamp = parseInt(Date.now() / 1000) + timeout;
    redisClient.zAdd(TIMEOUT_SET_KEY, [{score: timeoutTimestamp, value: jobId}])
        .then((zAddResult) => {
            logger.info(`Persisted timeout for Job [${jobId}] @${timeoutTimestamp}`);
        })
        .catch((error) => {
            logger.error(error, `Failed to persist timeout for Job [${jobId}]`);
        });
};

const purgeTimeout = (jobId) => {
    if (timeouts[jobId]) {
        logger.debug(`Cancelling timeout for Job [${jobId}]`);
        clearTimeout(timeouts[jobId]);
        delete timeouts[jobId];
    }
    redisClient.zRem(TIMEOUT_SET_KEY, [jobId])
        .then((zRemResult) => {
            logger.debug(`Removed persisted timeout for Job [${jobId}]`);
        })
        .catch((error) => {
            logger.error(error, `Failed to remove persisted timeout for Job [${jobId}] from Redis`);
        });
};

const syncPersistedTimeouts = () => {
    const from = 0;
    const nowSecs = parseInt(Date.now() / 1000);
    const until = nowSecs + (appConfig.timeout_sync_interval * 3);
    logger.debug(`Looking for persisted timeouts in range [${from}-${until}]`)
    redisClient.zRangeWithScores(TIMEOUT_SET_KEY, from, until, {BY:'SCORE'})
        .then((persistedTimeoutResult) => {
            if (persistedTimeoutResult.length < 1) {
                return;
            }
            persistedTimeoutResult.forEach((persistedTimeout) => {
                const jobId = persistedTimeout.value;
                if (timeouts.hasOwnProperty(jobId)) {
                    logger.debug(`Job [${jobId}] timeout still in-memory`);
                } else {
                    logger.info(`Job [${jobId}] timeout not in-memory, re-syncing`);
                    // Convert score back into a SECONDS timeout
                    const remainingTimeoutSecs = Math.max(0, nowSecs - parseInt(persistedTimeout.score));
                    registerTimeout(jobId, remainingTimeoutSecs);
                }
            });
        })
        .catch((error) => {
            logger.error(error, `Failed to scan for persisted timeouts`);
        });
};

module.exports.newJobRequest = (jobId, timeout) => {
    logger.info(`New job [${jobId}] timeout [${timeout}s]`);
    registerTimeout(jobId, timeout);
    persistTimeout(jobId, timeout);
};

module.exports.cancelForJob = (jobId) => {
    logger.info(`Request to cancel timeout for job [${jobId}]`);
    purgeTimeout(jobId);
};

setInterval(syncPersistedTimeouts, appConfig.timeout_sync_interval * 1000);
syncPersistedTimeouts();