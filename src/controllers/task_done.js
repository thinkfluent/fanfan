const appConfig = require('../config.js');
const logger = require('../logger.js');
const redisClient = require('../redis.js');
const pubsub = require('../pubsub.js');
const itemStatus = require("../status.js");
const cacheKeys = require("../cache_keys.js");
const validator = require('../validate.js');

module.exports = (req, res) => {
    const [attribs, taskOutcome] = pubsub.extractPubSub(req.body.message);
    logger.debug({taskOutcome}, 'PS:taskOutcome');

    try {
        validator.validateTaskOutcome(taskOutcome);
    } catch (error) {
        logger.error({taskOutcome}, 'Invalid taskOutcome, ignoring');
        // Send a 200 anyway, as this is a dead end
        res.status(200).json({});
        return;
    }

    const jobId = taskOutcome.jobId;
    const taskId = taskOutcome.taskId;

    // Redis keys
    const [taskOkCountKey, taskFailCountKey] = cacheKeys.countKeys(jobId);
    const [jobStartKey, jobTasksKey, jobRequestKey] = cacheKeys.coreKeys(jobId);

    const thisTaskFailed = (itemStatus.task.SUCCEEDED !== taskOutcome.status);
    const incrTargetKey = thisTaskFailed ? taskFailCountKey : taskOkCountKey;
    redisClient.incr(incrTargetKey).then((incrResult) => {
        redisClient.sRem(jobTasksKey, [taskId]).then((sRemResult) => {
            // Cleared 1 task
            redisClient.sCard(jobTasksKey).then((sCardResult) => {
                // Tasks remaining: sCardResult
                if (sCardResult < 1) {
                    // All tasks done
                    redisClient.mGet([taskOkCountKey, taskFailCountKey, jobStartKey, jobRequestKey]).then((mGetResult) => {
                        // Cleanup (delete counts, job meta, task list)
                        redisClient.del([taskOkCountKey, taskFailCountKey, jobStartKey, jobTasksKey, jobRequestKey]);
                        // Prep stats payload
                        const [taskOkCount, taskFailCount, jobStartTime, jobRequestJson] = mGetResult;
                        const jobSuccessful = (!thisTaskFailed && !taskFailCount);
                        const jobSummary = {
                            'jobId': jobId,
                            'request': JSON.parse(jobRequestJson),
                            'status': jobSuccessful ? itemStatus.job.SUCCEEDED : itemStatus.job.FAILED,
                            'taskCounts': {
                                [itemStatus.task.SUCCEEDED]: parseInt(taskOkCount || 0),
                                [itemStatus.task.FAILED]: parseInt(taskFailCount || 0),
                            },
                            'startedTsp': Math.ceil(jobStartTime / 1000),
                            'tookMs': Date.now() - jobStartTime
                        };
                        logger.info(jobSummary, 'Job (all tasks) complete');

                        // Publish Job Done
                        pubsub.getTopic(appConfig.pubsub_topic_job_done).publishMessage({
                            data: Buffer.from(JSON.stringify(jobSummary))
                        }).then((messageId) => {
                            res.json({jobId, ok: jobSuccessful});
                        }).catch((error) => {
                            logger.error({}, 'Failed to publish fan-in message');
                            // @todo handle error publishing final FAN-IN action (e.g. retry)
                            // @todo store in Redis for re-publish?
                            // @todo consider setTimeout() with republish?
                        });
                    });
                } else {
                    // @todo still tasks to go
                    res.json({jobId});
                }
            }).catch((error) => {
                logger.warn(error, 'Failed to sCard');
            });
        }).catch((error) => {
            logger.warn(error, 'Failed to sRem');
        });
    }).catch((error) => {
        logger.warn(error, 'Failed to incr')
    });
}