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
    const [jobStartKey, jobTasksKey, jobRequestKey, jobDoneKey] = cacheKeys.coreKeys(jobId);

    const thisTaskFailed = (itemStatus.task.SUCCEEDED !== taskOutcome.status);
    const incrTargetKey = thisTaskFailed ? taskFailCountKey : taskOkCountKey;

    // Attempt to remove the Job/Task set member first
    redisClient.sRem(jobTasksKey, [taskId]).then((sRemResult) => {
        if (0 === sRemResult) {
            // We FAILED to clear the job/task set member... duplicate delivery?
            logger.debug({sRemResult}, 'Failed to remove Job/Task set member, assume duplicate delivery');
            res.json({jobId, duplicate: true});
            return;
        }

        redisClient.incr(incrTargetKey).then((incrResult) => {
            redisClient.sCard(jobTasksKey).then((sCardResult) => {
                // Tasks remaining: sCardResult
                if (sCardResult < 1) {
                    // All tasks done
                    // Check for race condition on last Task / Job completion
                    redisClient.set(jobDoneKey, jobDoneKey, {NX: true, EX: appConfig.nx_done_ttl}).then((setNXResult) => {
                        if (setNXResult) {
                            // We have the "lock" for the JobDone check
                            redisClient.mGet([taskOkCountKey, taskFailCountKey, jobStartKey, jobRequestKey]).then((mGetResult) => {
                                // Cleanup (delete counts, job meta, task list)
                                // Do NOT remove the done key, it helps with duplicate delivery protection / debug
                                redisClient.del([taskOkCountKey, taskFailCountKey, jobStartKey, jobTasksKey, jobRequestKey]);
                                // Prep stats payload
                                const [taskOkCount, taskFailCount, jobStartTime, jobRequestJson] = mGetResult;
                                const jobSuccessful = (!thisTaskFailed && !taskFailCount);
                                const jobRequest = JSON.parse(jobRequestJson);
                                const jobSummary = {
                                    'jobId': jobId,
                                    'request': jobRequest,
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
                                const jobDoneTopicName = jobRequest.doneTopic || appConfig.pubsub_topic_job_done;
                                pubsub.getTopic(jobDoneTopicName).publishMessage({
                                    data: Buffer.from(JSON.stringify(jobSummary))
                                }).then((messageId) => {
                                    res.json({jobId, ok: jobSuccessful});
                                }).catch((error) => {
                                    logger.error({jobSummary}, 'Failed to publish fan-in message');
                                    // @todo store in Redis for re-publish?
                                    // @todo consider setTimeout() with republish?
                                    // Remove the done key - as we failed to publish the outcome, and want a retry
                                    void redisClient.del(jobDoneKey);
                                    res.status(503).json({jobId});
                                });
                            }).catch((error) => {
                                logger.warn(error, 'Failed to mGet/process job data in NX locked handler');
                            });
                        } else {
                            logger.debug(setNXResult, `JobDone race condition avoided.`);
                        }
                    }).catch((error) => {
                        // @todo determine best approach here (e.g. carry out JobDone work anyway)
                        logger.warn(error, 'Failed to setNX for JobDone race condition avoidance');
                    });
                } else {
                    // Still tasks remaining
                    res.json({jobId});
                }
            }).catch((error) => {
                logger.warn(error, 'Failed to sCard/job task set');
            });
        }).catch((error) => {
            logger.warn(error, 'Failed to incr/job task counter')
        });
    }).catch((error) => {
        logger.warn(error, 'Failed to sRem/job task set');
    });
}