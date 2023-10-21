const appConfig = require('./config.js');
const logger = require('./logger.js');
const redisClient = require('./redis.js');
const pubsub = require('./pubsub.js');
const itemStatus = require("./status.js");
const cacheKeys = require("./cache_keys.js");

const publish = (jobSummary) => {
    return new Promise((resolve, reject) => {
        const jobDoneTopicName = jobSummary.request.doneTopic || appConfig.pubsub_topic_job_done;
        pubsub.getTopic(jobDoneTopicName).publishMessage({
            data: Buffer.from(JSON.stringify(jobSummary))
        }).then((messageId) => {
            resolve();
        }).catch((error) => {
            logger.error(error, `Failed to publish fan-in / JobOutcome message. Topic [${jobDoneTopicName}]`);
            // @todo handle error publishing final FAN-IN action (e.g. retry)
            // @todo store in Redis for re-publish?
            // @todo consider setTimeout() with republish?
            reject();
        });
    });
};

const buildOutcome = (jobId) => {
    return new Promise((resolve, reject) => {
        const [taskOkCountKey, taskFailCountKey] = cacheKeys.countKeys(jobId);
        const [jobStartKey, jobTasksKey, jobRequestKey] = cacheKeys.coreKeys(jobId);
        redisClient.mGet([taskOkCountKey, taskFailCountKey, jobStartKey, jobRequestKey]).then((mGetResult) => {
            const [taskOkCount, taskFailCount, jobStartTime, jobRequestJson] = mGetResult;
            resolve({
                jobId: jobId,
                request: JSON.parse(jobRequestJson),
                status: (!taskFailCount) ? itemStatus.job.SUCCEEDED : itemStatus.job.FAILED,
                taskCounts: {
                    [itemStatus.task.SUCCEEDED]: parseInt(taskOkCount || 0),
                    [itemStatus.task.FAILED]: parseInt(taskFailCount || 0),
                },
                startedTsp: Math.ceil(jobStartTime / 1000),
                tookMs: Date.now() - jobStartTime
            });
        });
    });
};

module.exports.runForLastTaskDone = (jobId) => {
    return new Promise((resolve, reject) => {
        buildOutcome(jobId).then((jobOutcome) => {
            publish(jobOutcome).then(() => {
                resolve();
            }).catch((error) => {
                reject(error);
            });
        });
    });
};

module.exports.runForTimeout = (jobId) => {
    return new Promise((resolve, reject) => {
        // Count remaining tasks
        const [_, jobTasksKey] = cacheKeys.coreKeys(jobId);
        redisClient.sCard(jobTasksKey).then((sCardResult) => {
            // Tasks remaining: sCardResult
            buildOutcome(jobId).then(jobOutcome => {
                // Augment the summary with timeout count & status
                const timedOutTaskCount = parseInt(sCardResult || 0);
                jobOutcome.taskCounts[itemStatus.task.TIMEOUT] = timedOutTaskCount;
                if (timedOutTaskCount > 0) {
                    jobOutcome.status = itemStatus.job.TIMEOUT;
                }
                publish(jobOutcome).then(() => {
                    resolve();
                }).catch((error) => {
                    reject(error);
                });
            }).catch((error) => {
                logger.error(error, `Failed to build Outcome for jobId [${jobId}]`);
                reject(error);
            });
        });
    });
};