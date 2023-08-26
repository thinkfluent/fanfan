const appConfig = require('./config.js');
const logger = require('./logger.js');
const outcomeBuilder = require('./job_outcome.js');

const POLL_INTERVAL = 15000;

// @todo create & track timeouts per JOB in REDIS (to support in-memory)


const timeouts = {};

module.exports.newJobRequest = (jobId, timeout) => {
    logger.info(`New job [${jobId}] timeout [${timeout}s]`);
    timeouts[jobId] = setTimeout(() => {
        logger.info(`Job [${jobId}] timeout expired`);
        outcomeBuilder.runForTimeout(jobId);
        // @todo repeat timeout?
    }, timeout * 1000);
};

module.exports.cancelForJob = (jobId) => {
    logger.info(`Request to cancel job [${jobId}] timeout`);
    if (timeouts[jobId]) {
        clearTimeout(timeouts[jobId]);
        delete timeouts[jobId];
    }
};

setInterval(() => {
    // @todo poll for any timeouts left in Redis
}, POLL_INTERVAL);